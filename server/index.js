require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuid } = require("uuid");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");

const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.APP_URL || process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:5173";
const CLIENT_URLS = (process.env.CLIENT_URLS || CLIENT_URL)
  .split(",")
  .map(url => url.trim())
  .filter(Boolean);
const DATABASE_PATH = process.env.DATABASE_PATH || "./support.sqlite";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin12345";
if (process.env.NODE_ENV === "production" && (ADMIN_PASSWORD.length < 14 || ["admin12345", "change-this-before-deploying"].includes(ADMIN_PASSWORD) || ADMIN_EMAIL === "admin@example.com")) {
  throw new Error("Production requires a real ADMIN_EMAIL and a unique ADMIN_PASSWORD of at least 14 characters.");
}
const OWNER_EMAIL = (process.env.OWNER_EMAIL || ADMIN_EMAIL || "danielkariuki3005@gmail.com").toLowerCase();
const PRODUCT_NAME = "24/7Support";

const PLAN_LIMITS = {
  free: { websites: 1, staffSeats: 1, monthlyConversations: 50, aiDrafts: false },
  starter: { websites: 1, staffSeats: 3, monthlyConversations: 500, aiDrafts: false },
  growth: { websites: 3, staffSeats: 8, monthlyConversations: 2000, aiDrafts: true },
  partner: { websites: 10, staffSeats: 20, monthlyConversations: 10000, aiDrafts: true }
};

const PLAN_NAMES = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  partner: "Partner"
};

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY_HOPS) app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
const server = http.createServer(app);
const db = new Database(DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "12mb", verify: (req, res, buffer) => { if (req.originalUrl === "/api/webhooks/whop") req.rawBody = buffer; } }));
app.use((req, res, next) => { res.set("Referrer-Policy", "no-referrer"); res.set("X-Content-Type-Options", "nosniff"); if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store"); next(); });

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
  }
});

const DEFAULT_THEME = {
  brandName: PRODUCT_NAME,
  accentColor: "#14b8a6",
  launcherColor: "#0f172a",
  panelColor: "#0b1220",
  textColor: "#f8fafc",
  greeting: "Hi, how can we help?",
  replyTime: "We typically reply in a few hours",
  position: "right"
};

const DEFAULT_AUTOMATIONS = [
  {
    id: "welcome",
    title: "Welcome auto-reply",
    body: "Thanks for reaching out. We typically reply in a few hours. Please share any more info or relevant screenshots that can help us assist you better.",
    auto_send: 1,
    sort_order: 10
  },
  {
    id: "details",
    title: "Request info",
    body: "Thanks for reaching out. Please share your X username, the package or order you selected, and the exact issue you are seeing so we can check it quickly.",
    auto_send: 0,
    sort_order: 20
  },
  {
    id: "screenshot",
    title: "Ask for screenshots",
    body: "Could you send a relevant screenshot or screen recording of what you are seeing? Please hide private keys, seed phrases, or sensitive payment details before sharing.",
    auto_send: 0,
    sort_order: 30
  }
];

db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_reads (
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_message_rowid INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, conversation_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT DEFAULT '',
  widget_key TEXT NOT NULL UNIQUE,
  secret_key TEXT NOT NULL UNIQUE,
  theme_json TEXT NOT NULL,
  ai_enabled INTEGER DEFAULT 1,
  plan TEXT DEFAULT 'free',
  billing_status TEXT DEFAULT 'owner_approved',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT,
  email TEXT,
  wallet TEXT,
  x_username TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  customer_id TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  assigned_to TEXT,
  page_url TEXT,
  screenshot_url TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  attachments_json TEXT DEFAULT '[]',
  ai_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS automation_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  auto_send INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS plan_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  plan TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  website_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  reviewed_by TEXT DEFAULT '',
  reviewed_at TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
`);

db.exec("CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id); CREATE INDEX IF NOT EXISTS conversations_project_idx ON conversations(project_id, updated_at)");

function now() {
  return new Date().toISOString();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(existingColumn => existingColumn.name === column)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn("customers", "project_id", "TEXT");
ensureColumn("customers", "x_username", "TEXT DEFAULT ''");
ensureColumn("conversations", "project_id", "TEXT");
ensureColumn("conversations", "screenshot_url", "TEXT DEFAULT ''");
ensureColumn("messages", "attachments_json", "TEXT DEFAULT '[]'");
ensureColumn("messages", "ai_generated", "INTEGER DEFAULT 0");
ensureColumn("automation_templates", "project_id", "TEXT");
ensureColumn("projects", "plan", "TEXT DEFAULT 'free'");
ensureColumn("projects", "billing_status", "TEXT DEFAULT 'owner_approved'");

function randomKey(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const attempted = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === attempted.length && crypto.timingSafeEqual(expected, attempted);
}

function parseTheme(value) {
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(value || "{}") };
  } catch {
    return DEFAULT_THEME;
  }
}

function cleanTheme(theme = {}) {
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
  return {
    customPresets: (Array.isArray(theme.customPresets) ? theme.customPresets : []).slice(0, 8).filter(p => p && typeof p.name === "string").map(p => ({ name: p.name.trim().slice(0, 32), accentColor: color(p.accentColor, DEFAULT_THEME.accentColor), launcherColor: color(p.launcherColor, DEFAULT_THEME.launcherColor), panelColor: color(p.panelColor, DEFAULT_THEME.panelColor), textColor: color(p.textColor, DEFAULT_THEME.textColor) })),
    brandName: String(theme.brandName || DEFAULT_THEME.brandName).slice(0, 80),
    accentColor: color(theme.accentColor, DEFAULT_THEME.accentColor),
    launcherColor: color(theme.launcherColor, DEFAULT_THEME.launcherColor),
    panelColor: color(theme.panelColor, DEFAULT_THEME.panelColor),
    textColor: color(theme.textColor, DEFAULT_THEME.textColor),
    greeting: String(theme.greeting || DEFAULT_THEME.greeting).slice(0, 140),
    replyTime: String(theme.replyTime || DEFAULT_THEME.replyTime).slice(0, 140),
    position: theme.position === "left" ? "left" : "right"
  };
}

function formatProject(row) {
  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.website_url,
    widgetKey: row.widget_key,
    secretKey: row.secret_key,
    theme: parseTheme(row.theme_json),
    aiEnabled: Boolean(row.ai_enabled),
    plan: row.plan || "free",
    billingStatus: row.billing_status || "owner_approved",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function formatStaffUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role || "agent",
    createdAt: row.created_at
  };
}

function formatPlanRequest(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    plan: row.plan,
    planName: PLAN_NAMES[row.plan] || row.plan,
    companyName: row.company_name,
    contactEmail: row.contact_email,
    websiteUrl: row.website_url,
    notes: row.notes,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

function isOwner(session) {
  return String(session?.email || "").toLowerCase() === OWNER_EMAIL;
}

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function getProjectUsage(projectId) {
  const staffSeats = db.prepare("SELECT COUNT(*) as count FROM staff_users WHERE project_id = ?").get(projectId).count;
  const monthlyConversations = db.prepare(`
    SELECT COUNT(*) as count FROM conversations
    WHERE project_id = ?
      AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get(projectId).count;
  return { staffSeats, monthlyConversations };
}

function getPlanSummary(project) {
  const limits = getPlanLimits(project.plan);
  return {
    plan: project.plan,
    planName: PLAN_NAMES[project.plan] || project.plan,
    billingStatus: project.billingStatus,
    limits,
    usage: getProjectUsage(project.id)
  };
}

function requireActivePlan(project) {
  if (project.billingStatus === "paused") {
    return { allowed: false, status: 402, error: "This workspace is paused. Contact the team to restore access." };
  }
  return { allowed: true };
}

function requireConversationAllowance(project) {
  const active = requireActivePlan(project);
  if (!active.allowed) return active;
  const limits = getPlanLimits(project.plan);
  const usage = getProjectUsage(project.id);
  if (usage.monthlyConversations >= limits.monthlyConversations) {
    return {
      allowed: false,
      status: 402,
      error: `${PLAN_NAMES[project.plan] || "Current"} plan limit reached: ${limits.monthlyConversations} conversations this month.`
    };
  }
  return { allowed: true };
}

function seedDefaultProject() {
  let project = db.prepare("SELECT * FROM projects ORDER BY created_at ASC LIMIT 1").get();

  if (!project) {
    const projectId = uuid();
    db.prepare(`
      INSERT INTO projects (id, name, website_url, widget_key, secret_key, theme_json, ai_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      projectId,
      "FMAX",
      "http://localhost:5173",
      "demo_widget_key",
      randomKey("secret"),
      JSON.stringify(DEFAULT_THEME),
      now(),
      now()
    );
    project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  }

  db.prepare("UPDATE customers SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(project.id);
  db.prepare("UPDATE conversations SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(project.id);
  db.prepare("UPDATE automation_templates SET project_id = ? WHERE project_id IS NULL OR project_id = ''").run(project.id);

  const currentTheme = parseTheme(project.theme_json);
  if (currentTheme.brandName === "FMAX Support") {
    db.prepare("UPDATE projects SET theme_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ ...currentTheme, brandName: PRODUCT_NAME }), now(), project.id);
    project = db.prepare("SELECT * FROM projects WHERE id = ?").get(project.id);
  }

  const admin = db.prepare("SELECT id FROM staff_users WHERE email = ?").get(ADMIN_EMAIL.toLowerCase());
  if (!admin) {
    db.prepare(`
      INSERT INTO staff_users (id, project_id, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, 'admin', ?)
    `).run(uuid(), project.id, ADMIN_EMAIL.toLowerCase(), hashPassword(ADMIN_PASSWORD), now());
  }

  const existingTemplates = db.prepare("SELECT COUNT(*) as count FROM automation_templates WHERE project_id = ?").get(project.id);
  if (existingTemplates.count === 0) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO automation_templates (id, project_id, title, body, auto_send, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const template of DEFAULT_AUTOMATIONS) {
      insert.run(template.id, project.id, template.title, template.body, template.auto_send, template.sort_order, now());
    }
  }

  return project;
}

seedDefaultProject();

function getProjectByWidgetKey(widgetKey) {
  if (!widgetKey) return null;
  const row = db.prepare("SELECT * FROM projects WHERE widget_key = ?").get(widgetKey);
  return row ? formatProject(row) : null;
}

function getDefaultProject() {
  return formatProject(db.prepare("SELECT * FROM projects ORDER BY created_at ASC LIMIT 1").get());
}

function parseAttachments(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function cleanAttachments(attachments = []) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .slice(0, 4)
    .filter(attachment => (
      attachment
      && typeof attachment.name === "string"
      && typeof attachment.type === "string"
      && typeof attachment.dataUrl === "string"
      && attachment.type.startsWith("image/")
      && attachment.dataUrl.startsWith("data:image/")
      && attachment.dataUrl.length < 3_500_000
    ))
    .map(attachment => ({
      id: attachment.id || uuid(),
      name: attachment.name.slice(0, 140),
      type: attachment.type.slice(0, 80),
      dataUrl: attachment.dataUrl
    }));
}

function formatMessage(row) {
  return {
    ...row,
    attachments: parseAttachments(row.attachments_json),
    aiGenerated: Boolean(row.ai_generated),
    attachments_json: undefined,
    ai_generated: undefined
  };
}

function formatAutomation(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    autoSend: Boolean(row.auto_send),
    sortOrder: row.sort_order
  };
}

function getAutomationTemplates(projectId) {
  return db.prepare(`
    SELECT * FROM automation_templates
    WHERE project_id = ?
    ORDER BY sort_order ASC, title ASC
  `).all(projectId).map(formatAutomation);
}

function insertMessage({ conversationId, senderType, senderName, body, attachments = [], aiGenerated = false }) {
  const message = {
    id: uuid(),
    conversation_id: conversationId,
    sender_type: senderType,
    sender_name: senderName || (senderType === "agent" ? "Support" : "Customer"),
    body: typeof body === "string" ? body.trim() : "",
    attachments,
    ai_generated: aiGenerated ? 1 : 0,
    created_at: now()
  };

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_type, sender_name, body, attachments_json, ai_generated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    message.conversation_id,
    message.sender_type,
    message.sender_name,
    message.body,
    JSON.stringify(message.attachments),
    message.ai_generated,
    message.created_at
  );

  const project = db.prepare("SELECT project_id FROM conversations WHERE id = ?").get(conversationId);
  if (project) teamWebhooks.enqueue(project.project_id, "message.created", { id: message.id, conversation_id: conversationId, sender_type: senderType, body: message.body, created_at: message.created_at });
  return formatMessage({ ...message, attachments_json: JSON.stringify(message.attachments) });
}

async function sendDiscordAlert(conversation, message) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `New support conversation\nProject: ${conversation.projectName || "Support"}\nCustomer: ${conversation.name || "Unknown"}\nEmail: ${conversation.email || "N/A"}\nX username: ${conversation.xUsername || "N/A"}\nMessage: ${message}`
      })
    });
  } catch (error) {
    console.error("Discord webhook failed:", error.message);
  }
}

function getConversationFull(conversationId, projectId) {
  const query = `
    SELECT c.*, cu.name, cu.email, cu.wallet, cu.x_username
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.id = ? ${projectId ? "AND c.project_id = ?" : ""}
  `;
  const conversation = projectId
    ? db.prepare(query).get(conversationId, projectId)
    : db.prepare(query).get(conversationId);

  if (!conversation) return null;

  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(conversationId).map(formatMessage);

  return { ...conversation, messages };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function authenticateToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.*, u.email, u.role, u.project_id, p.name as project_name
    FROM auth_sessions s
    JOIN staff_users u ON u.id = s.user_id
    JOIN projects p ON p.id = u.project_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now());
  return row || null;
}

function requireAdmin(req, res, next) {
  const session = authenticateToken(getBearerToken(req));
  if (!session) return res.status(401).json({ error: "Admin login required." });
  req.admin = session;
  next();
}

function requireWorkspaceAdmin(req, res, next) {
  if (req.admin.role !== "admin" && !isOwner(req.admin)) return res.status(403).json({ error: "Only workspace admins can change settings." });
  next();
}

function requireConversationAccess(req, res, next) {
  const admin = authenticateToken(getBearerToken(req));
  if (admin) {
    req.projectId = admin.project_id;
    req.admin = admin;
    return next();
  }

  const widgetKey = req.headers["x-widget-key"] || req.query.widgetKey || req.body.widgetKey;
  const project = getProjectByWidgetKey(widgetKey);
  if (!project) return res.status(401).json({ error: "Valid widget key required." });
  const active = requireActivePlan(project);
  if (!active.allowed) return res.status(active.status).json({ error: active.error });
  req.project = project;
  req.projectId = project.id;
  next();
}

function requireWidgetProject(req, res, next) {
  const widgetKey = req.headers["x-widget-key"] || req.query.widgetKey || req.body.widgetKey;
  const project = getProjectByWidgetKey(widgetKey);
  if (!project) return res.status(401).json({ error: "Valid widget key required." });
  const active = requireActivePlan(project);
  if (!active.allowed) return res.status(active.status).json({ error: active.error });
  req.project = project;
  req.projectId = project.id;
  next();
}

function emitProject(projectId, eventName, payload) {
  io.to(`project:${projectId}`).emit(eventName, payload);
  if (["conversation:new", "conversation:updated"].includes(eventName)) teamWebhooks.enqueue(projectId, eventName === "conversation:new" ? "conversation.created" : "conversation.updated", { id: payload.id, status: payload.status, updated_at: payload.updated_at });
}

const authAttempts = new Map();
function limitAuth(req, res, next) {
  const authPath = req.originalUrl.split("?")[0];
  const key = req.ip + ":" + authPath;
  const current = Date.now();
  for (const [ip, value] of authAttempts) if (value.until < current) authAttempts.delete(ip);
  const entry = authAttempts.get(key) || { count: 0, until: current + 15 * 60 * 1000 };
  authAttempts.set(key, entry);
  if (++entry.count > (authPath.endsWith("register") ? 20 : authPath.endsWith("forgot-password") ? 10 : 100)) {
    res.set("Retry-After", String(Math.ceil((entry.until - current) / 1000)));
    return res.status(429).json({ error: "Too many attempts. Please try again later." });
  }
  next();
}
app.use("/api/auth/register", limitAuth);
app.use("/api/auth/login", limitAuth);
app.use("/api/auth/forgot-password", limitAuth);
app.use("/api/auth/reset-password", limitAuth);

const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  requireTLS: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  connectionTimeout: 10000, socketTimeout: 15000
}) : null;
const resetHash = token => crypto.createHash("sha256").update(token).digest("hex");
function disconnectSessions(tokens) {
  for (const socket of io.sockets.sockets.values()) if (tokens.includes(socket.data.sessionToken)) socket.disconnect(true);
}
app.post("/api/auth/forgot-password", async (req, res) => {
  if (!mailer || !process.env.MAIL_FROM) return res.status(503).json({ error: "Email recovery is not configured yet. Please contact your workspace administrator." });
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = db.prepare("SELECT id, email FROM staff_users WHERE email = ?").get(email);
  // Queue delivery without making the account's existence observable through the response.
  const recentReset = user && db.prepare("SELECT token_hash FROM password_resets WHERE user_id = ? AND expires_at > ?").get(user.id, new Date(Date.now() + 29 * 60000).toISOString());
  if (user && !recentReset) {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = resetHash(token);
    db.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?").run(user.id, now());
    db.prepare("INSERT INTO password_resets VALUES (?, ?, ?)").run(hash, user.id, new Date(Date.now() + 30 * 60000).toISOString());
    const link = new URL("/admin/reset-password", process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || CLIENT_URL);
    link.hash = "token=" + token;
    mailer.sendMail({ from: process.env.MAIL_FROM, to: user.email, subject: "Reset your 24/7Support password", text: `Use this link to choose a new password: ${link.href}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, ignore this email.` })
      .catch(() => { db.prepare("DELETE FROM password_resets WHERE token_hash = ?").run(hash); console.error("Password reset email delivery failed. Check SMTP configuration."); });
  }
  res.json({ message: "If an account exists for that email, a reset link will arrive shortly. Check your spam folder too." });
});
app.post("/api/auth/reset-password", (req, res) => {
  const token = String(req.body.token || "");
  const password = String(req.body.password || "");
  if (!/^[a-f0-9]{64}$/.test(token) || password.length < 10 || password.length > 256) return res.status(400).json({ error: "Use a valid reset link and a password of 10–256 characters." });
  const reset = db.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?").get(resetHash(token), now());
  if (!reset) return res.status(400).json({ error: "This reset link has expired or already been used. Request a new one." });
  const tokens = db.prepare("SELECT token FROM auth_sessions WHERE user_id = ?").all(reset.user_id).map(row => row.token);
  db.transaction(() => {
    db.prepare("UPDATE staff_users SET password_hash = ? WHERE id = ?").run(hashPassword(password), reset.user_id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(reset.user_id);
    db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(reset.user_id);
  })();
  disconnectSessions(tokens);
  res.json({ message: "Password updated. Sign in with your new password." });
});

app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const name = String(req.body.name || "").trim().slice(0, 120);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 256) {
    return res.status(400).json({ error: "Enter a workspace name, valid email, and password of 10–256 characters." });
  }
  if (db.prepare("SELECT id FROM staff_users WHERE email = ?").get(email)) return res.status(409).json({ error: "That email already has an account. Sign in instead." });
  const projectId = uuid(), userId = uuid();
  db.transaction(() => {
    db.prepare("INSERT INTO projects (id, name, widget_key, secret_key, theme_json) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, name, randomKey("widget"), randomKey("secret"), JSON.stringify({ ...DEFAULT_THEME, brandName: name }));
    db.prepare("INSERT INTO staff_users (id, project_id, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')")
      .run(userId, projectId, email, hashPassword(password));
    for (const t of DEFAULT_AUTOMATIONS) db.prepare("INSERT INTO automation_templates (id, project_id, title, body, auto_send, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuid(), projectId, t.title, t.body, t.auto_send, t.sort_order);
  })();
  res.status(201).json({ ok: true });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM staff_users WHERE email = ?").get(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = randomKey("session");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare("INSERT INTO auth_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(token, user.id, expiresAt, now());

  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(user.project_id));
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, projectId: user.project_id, isOwner: user.email === OWNER_EMAIL },
    project
  });
});

app.get("/api/auth/me", requireAdmin, (req, res) => {
  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));
  res.json({
    user: { id: req.admin.user_id, email: req.admin.email, role: req.admin.role, projectId: req.admin.project_id, isOwner: isOwner(req.admin) },
    project,
    billing: getPlanSummary(project)
  });
});

app.post("/api/auth/logout", requireAdmin, (req, res) => {
  disconnectSessions([getBearerToken(req)]);
  db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(getBearerToken(req));
  res.json({ ok: true });
});

app.get("/api/public/widget", (req, res) => {
  const project = process.env.PUBLIC_SUPPORT_WIDGET_KEY ? getProjectByWidgetKey(process.env.PUBLIC_SUPPORT_WIDGET_KEY) : getDefaultProject();
  if (!project || !requireActivePlan(project).allowed) return res.status(404).json({ error: "Support widget unavailable." });
  res.json({ widgetKey: project.widgetKey });
});

app.get("/api/widget/config", requireWidgetProject, (req, res) => {
  const active = requireActivePlan(req.project);
  if (!active.allowed) return res.status(active.status).json({ error: active.error });
  res.json({
    projectId: req.project.id,
    brandName: req.project.theme.brandName,
    theme: req.project.theme,
    aiEnabled: req.project.aiEnabled && getPlanLimits(req.project.plan).aiDrafts,
    billing: { plan: req.project.plan, limits: getPlanLimits(req.project.plan) }
  });
});

app.get("/widget-demo", (req, res) => {
  const project = getProjectByWidgetKey(String(req.query.key || ""));
  if (!project) return res.status(404).send("Widget not found.");
  res.set("Content-Security-Policy", "frame-ancestors 'self' " + CLIENT_URLS.join(" "));
  res.type("html").send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Widget test page</title></head><body style="font:16px system-ui;padding:24px;background:#f1f5f9;color:#0f172a"><h1>Your widget is ready to test</h1><p>Open Chat, enter a customer ID, and send a message. It will appear in your support inbox.</p><script src="/widget.js" data-key="${project.widgetKey}"></script></body></html>`);
});

app.get("/widget.js", (req, res) => {
  res.type("application/javascript").send(widgetScript());
});

app.get("/api/projects/current", requireAdmin, (req, res) => {
  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));
  res.json({ ...project, billing: getPlanSummary(project) });
});

app.put("/api/projects/current", requireAdmin, requireWorkspaceAdmin, (req, res) => {
  const theme = cleanTheme(req.body.theme || {});
  const name = String(req.body.name || theme.brandName || "Support").trim().slice(0, 120);
  const websiteUrl = String(req.body.websiteUrl || "").trim().slice(0, 240);
  const aiEnabled = req.body.aiEnabled === false ? 0 : 1;

  db.prepare(`
    UPDATE projects SET name = ?, website_url = ?, theme_json = ?, ai_enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(name, websiteUrl, JSON.stringify(theme), aiEnabled, now(), req.admin.project_id);

  res.json(formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id)));
});

app.patch("/api/projects/current/billing", requireAdmin, (req, res) => {
  if (!isOwner(req.admin)) return res.status(403).json({ error: "Only the account owner can approve billing plans." });

  const allowedPlans = new Set(["free", "starter", "growth", "partner"]);
  const allowedStatuses = new Set(["owner_approved", "pending_approval", "paused"]);
  const plan = String(req.body.plan || "free").trim().toLowerCase();
  const billingStatus = String(req.body.billingStatus || "owner_approved").trim().toLowerCase();

  if (!allowedPlans.has(plan) || !allowedStatuses.has(billingStatus)) {
    return res.status(400).json({ error: "Choose a valid plan and billing status." });
  }

  db.prepare("UPDATE projects SET plan = ?, billing_status = ?, updated_at = ? WHERE id = ?")
    .run(plan, billingStatus, now(), req.admin.project_id);
  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));
  res.json(project);
});

app.get("/api/billing/limits", (req, res) => {
  res.json({ plans: PLAN_LIMITS });
});

app.post("/api/billing/requests", requireAdmin, (req, res) => {
  const allowedPlans = new Set(Object.keys(PLAN_LIMITS));
  const plan = String(req.body.plan || "").trim().toLowerCase();
  const companyName = String(req.body.companyName || "").trim().slice(0, 120);
  const contactEmail = String(req.body.contactEmail || "").trim().toLowerCase().slice(0, 160);
  const websiteUrl = String(req.body.websiteUrl || "").trim().slice(0, 240);
  const notes = String(req.body.notes || "").trim().slice(0, 1000);
  const requester = authenticateToken(getBearerToken(req));
  const project = requester ? formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(requester.project_id)) : null;

  if (!allowedPlans.has(plan)) return res.status(400).json({ error: "Choose a valid plan." });
  if (!companyName) return res.status(400).json({ error: "Company or project name is required." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  const recentDuplicate = db.prepare(`
    SELECT * FROM plan_requests
    WHERE contact_email = ? AND plan = ? AND project_id IS ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `).get(contactEmail, plan, project?.id || null);

  if (recentDuplicate) return res.status(200).json({ request: formatPlanRequest(recentDuplicate), duplicate: true });

  const requestId = uuid();
  db.prepare(`
    INSERT INTO plan_requests (id, project_id, plan, company_name, contact_email, website_url, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(requestId, project?.id || null, plan, companyName, contactEmail, websiteUrl, notes, now());

  const request = db.prepare("SELECT * FROM plan_requests WHERE id = ?").get(requestId);
  res.status(201).json({ request: formatPlanRequest(request) });
});

app.get("/api/billing/requests", requireAdmin, (req, res) => {
  if (!isOwner(req.admin)) return res.status(403).json({ error: "Only the owner account can review plan requests." });
  const status = String(req.query.status || "").trim().toLowerCase();
  const rows = status
    ? db.prepare("SELECT * FROM plan_requests WHERE status = ? ORDER BY created_at DESC").all(status)
    : db.prepare("SELECT * FROM plan_requests ORDER BY created_at DESC").all();
  res.json(rows.map(formatPlanRequest));
});

app.patch("/api/billing/requests/:id", requireAdmin, (req, res) => {
  if (!isOwner(req.admin)) return res.status(403).json({ error: "Only the owner account can review plan requests." });

  const action = String(req.body.action || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ error: "Action must be approve or reject." });

  const request = db.prepare("SELECT * FROM plan_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Plan request not found." });
  if (action === "approve" && !request.project_id) return res.status(400).json({ error: "This prospect must create a workspace and submit an upgrade request while signed in." });
  if (request.status !== "pending") return res.status(400).json({ error: "This request has already been reviewed." });

  const nextStatus = action === "approve" ? "approved" : "rejected";
  const reviewedAt = now();
  const applyReview = db.transaction(() => {
    db.prepare("UPDATE plan_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .run(nextStatus, req.admin.email, reviewedAt, req.params.id);

    if (action === "approve") {
      db.prepare("UPDATE projects SET plan = ?, billing_status = 'owner_approved', website_url = COALESCE(NULLIF(?, ''), website_url), updated_at = ? WHERE id = ?")
        .run(request.plan, request.website_url || "", reviewedAt, request.project_id || req.admin.project_id);
    }
  });

  applyReview();
  const reviewed = db.prepare("SELECT * FROM plan_requests WHERE id = ?").get(req.params.id);
  res.json(formatPlanRequest(reviewed));
});

app.get("/api/staff", requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, role, created_at FROM staff_users
    WHERE project_id = ?
    ORDER BY created_at ASC
  `).all(req.admin.project_id).map(formatStaffUser);
  res.json(users);
});

app.post("/api/staff", requireAdmin, (req, res) => {
  if (!isOwner(req.admin) && req.admin.role !== "admin") {
    return res.status(403).json({ error: "Only admins can add teammates." });
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = req.body.role === "admin" ? "admin" : "agent";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid teammate email." });
  }

  if (password.length < 10) {
    return res.status(400).json({ error: "Temporary password must be at least 10 characters." });
  }

  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));
  const limits = getPlanLimits(project.plan);
  const usage = getProjectUsage(project.id);
  if (usage.staffSeats >= limits.staffSeats) {
    return res.status(402).json({ error: `${PLAN_NAMES[project.plan] || "Current"} plan allows ${limits.staffSeats} staff seat${limits.staffSeats === 1 ? "" : "s"}.` });
  }

  try {
    db.prepare(`
      INSERT INTO staff_users (id, project_id, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), req.admin.project_id, email, hashPassword(password), role, now());
  } catch (error) {
    return res.status(409).json({ error: "That staff email already exists." });
  }

  const users = db.prepare("SELECT id, email, role, created_at FROM staff_users WHERE project_id = ? ORDER BY created_at ASC")
    .all(req.admin.project_id)
    .map(formatStaffUser);
  res.status(201).json(users);
});

app.delete("/api/staff/:id", requireAdmin, (req, res) => {
  if (!isOwner(req.admin) && req.admin.role !== "admin") {
    return res.status(403).json({ error: "Only admins can remove teammates." });
  }

  if (req.params.id === req.admin.user_id) {
    return res.status(400).json({ error: "You cannot remove your own account while signed in." });
  }

  const revoked = db.prepare("SELECT token FROM auth_sessions WHERE user_id = ? AND user_id IN (SELECT id FROM staff_users WHERE project_id = ?)").all(req.params.id, req.admin.project_id).map(row => row.token);
  disconnectSessions(revoked);
  const result = db.prepare("DELETE FROM staff_users WHERE id = ? AND project_id = ?").run(req.params.id, req.admin.project_id);
  if (result.changes === 0) return res.status(404).json({ error: "Staff user not found." });
  db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/projects/current/rotate-key", requireAdmin, requireWorkspaceAdmin, (req, res) => {
  const widgetKey = randomKey("widget");
  db.prepare("UPDATE projects SET widget_key = ?, updated_at = ? WHERE id = ?").run(widgetKey, now(), req.admin.project_id);
  res.json(formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id)));
});

app.get("/api/automations", requireAdmin, (req, res) => {
  res.json(getAutomationTemplates(req.admin.project_id));
});

app.put("/api/automations", requireAdmin, requireWorkspaceAdmin, (req, res) => {
  const templates = Array.isArray(req.body.automations) ? req.body.automations : [];

  if (templates.length < 1 || templates.length > 12) {
    return res.status(400).json({ error: "Provide 1 to 12 automation templates." });
  }

  const normalized = templates.map((template, index) => ({
    id: String(template.id || `template-${uuid()}`).slice(0, 80),
    title: String(template.title || "").trim(),
    body: String(template.body || "").trim(),
    auto_send: template.autoSend ? 1 : 0,
    sort_order: index * 10
  }));

  if (normalized.some(template => !template.title || !template.body)) {
    return res.status(400).json({ error: "Each automation needs a title and message." });
  }

  if (new Set(normalized.map(t => t.id)).size !== normalized.length || normalized.some(t => t.title.length > 120 || t.body.length > 10000)) {
    return res.status(400).json({ error: "Use unique reply IDs, titles up to 120 characters, and messages up to 10,000 characters." });
  }
  if (normalized.some(t => db.prepare("SELECT id FROM automation_templates WHERE id = ? AND project_id != ?").get(t.id, req.admin.project_id))) {
    return res.status(409).json({ error: "Reply ID is unavailable. Add a new reply and try again." });
  }
  const saveTemplates = db.transaction(() => {
    db.prepare("DELETE FROM automation_templates WHERE project_id = ?").run(req.admin.project_id);
    const insert = db.prepare(`
      INSERT INTO automation_templates (id, project_id, title, body, auto_send, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const template of normalized) {
      insert.run(template.id, req.admin.project_id, template.title, template.body, template.auto_send, template.sort_order, now());
    }
  });

  saveTemplates();
  res.json(getAutomationTemplates(req.admin.project_id));
});

app.post("/api/conversations", requireWidgetProject, async (req, res) => {
  const { name, email, wallet, xUsername, screenshotUrl, pageUrl, userAgent, firstMessage } = req.body;
  const attachments = cleanAttachments(req.body.attachments);

  if (typeof firstMessage !== "string" || !firstMessage.trim() || firstMessage.length > 10000) {
    return res.status(400).json({ error: "First message is required." });
  }

  if (typeof xUsername !== "string" || !xUsername.trim() || xUsername.length > 120) {
    return res.status(400).json({ error: "X username is required." });
  }

  const allowance = requireConversationAllowance(req.project);
  if (!allowance.allowed) return res.status(allowance.status).json({ error: allowance.error });

  const customerId = uuid();
  const conversationId = uuid();

  db.prepare(`
    INSERT INTO customers (id, project_id, name, email, wallet, x_username, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(customerId, req.projectId, name || "", email || "", wallet || "", xUsername.trim(), now());

  db.prepare(`
    INSERT INTO conversations (id, project_id, customer_id, status, page_url, screenshot_url, user_agent, created_at, updated_at)
    VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)
  `).run(conversationId, req.projectId, customerId, pageUrl || "", screenshotUrl || "", userAgent || "", now(), now());

  insertMessage({
    conversationId,
    senderType: "user",
    senderName: name || "Customer",
    body: firstMessage,
    attachments
  });

  const autoReplies = db.prepare(`
    SELECT * FROM automation_templates
    WHERE project_id = ? AND auto_send = 1
    ORDER BY sort_order ASC, title ASC
  `).all(req.projectId);

  for (const template of autoReplies) {
    insertMessage({
      conversationId,
      senderType: "agent",
      senderName: req.project.theme.brandName,
      body: template.body
    });
  }

  const full = getConversationFull(conversationId, req.projectId);
  emitProject(req.projectId, "conversation:new", full);
  emitProject(req.projectId, "inbox:message", full.messages.find(message => message.sender_type === "user"));
  await sendDiscordAlert({ projectName: req.project.name, name, email, xUsername }, firstMessage.trim());

  res.status(201).json(full);
});

app.get("/api/inbox/activity", requireAdmin, (req, res) => {
  const latest = db.prepare("SELECT coalesce(max(m.rowid),0) AS cursor FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.project_id = ?").get(req.admin.project_id).cursor;
  const after = req.query.after === undefined ? latest : Math.max(0, Number(req.query.after) || 0);
  const messages = db.prepare("SELECT m.rowid AS sequence, m.id, m.conversation_id, m.sender_type, m.created_at FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.project_id = ? AND m.rowid > ? ORDER BY m.rowid LIMIT 200").all(req.admin.project_id, after);
  const unread = db.prepare("SELECT count(*) AS count FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.project_id = ? AND m.sender_type = 'user' AND m.rowid > coalesce((SELECT last_message_rowid FROM conversation_reads WHERE user_id = ? AND conversation_id = c.id),0)").get(req.admin.project_id, req.admin.user_id).count;
  res.json({ cursor: messages.length ? messages[messages.length - 1].sequence : latest, more: messages.length === 200, unread, messages });
});
app.post("/api/conversations/:id/read", requireAdmin, (req, res) => {
  if (!getConversationFull(req.params.id, req.admin.project_id)) return res.status(404).json({ error: "Conversation not found." });
  const latest = db.prepare("SELECT coalesce(max(rowid),0) AS cursor FROM messages WHERE conversation_id = ?").get(req.params.id).cursor;
  db.prepare("INSERT INTO conversation_reads VALUES (?, ?, ?) ON CONFLICT(user_id, conversation_id) DO UPDATE SET last_message_rowid = excluded.last_message_rowid").run(req.admin.user_id, req.params.id, latest);
  res.json({ ok: true });
});

app.get("/api/conversations", requireAdmin, (req, res) => {
  const status = String(req.query.status || "");
  const search = String(req.query.q || "").trim().slice(0, 200).toLowerCase();
  const rows = db.prepare(`
    SELECT c.*, cu.name, cu.email, cu.wallet, cu.x_username,
      (SELECT count(*) FROM messages unread WHERE unread.conversation_id = c.id AND unread.sender_type = 'user' AND unread.rowid > coalesce((SELECT last_message_rowid FROM conversation_reads WHERE user_id = ? AND conversation_id = c.id),0)) AS unread_count,
      (SELECT CASE WHEN body != '' THEN body ELSE '[Image attachment]' END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) as last_message
    FROM conversations c JOIN customers cu ON cu.id = c.customer_id
    WHERE c.project_id = ? AND (? = '' OR c.status = ?)
      AND (? = '' OR instr(lower(coalesce(cu.name,'') || ' ' || coalesce(cu.email,'') || ' ' || coalesce(cu.x_username,'') || ' ' || coalesce(cu.wallet,'')), ?) > 0
        OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND instr(lower(m.body), ?) > 0))
    ORDER BY c.updated_at DESC, c.rowid DESC
  `).all(req.admin.user_id, req.admin.project_id, status, status, search, search, search);

  res.json(rows);
});

app.get("/api/conversations/:id", requireConversationAccess, (req, res) => {
  const full = getConversationFull(req.params.id, req.projectId);
  if (!full) return res.status(404).json({ error: "Conversation not found." });
  res.json(full);
});

app.post("/api/conversations/:id/messages", requireConversationAccess, (req, res) => {
  const { senderType, senderName, body } = req.body;
  const attachments = cleanAttachments(req.body.attachments);

  if (!["user", "agent"].includes(senderType)) {
    return res.status(400).json({ error: "senderType must be user or agent." });
  }

  if (senderType === "agent" && !req.admin) {
    return res.status(403).json({ error: "Only staff can send agent messages." });
  }

  if ((body != null && (typeof body !== "string" || body.length > 10000)) || ((!body || !body.trim()) && attachments.length === 0)) {
    return res.status(400).json({ error: "Message body or attachment is required." });
  }

  const conversation = db.prepare("SELECT id FROM conversations WHERE id = ? AND project_id = ?").get(req.params.id, req.projectId);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });

  const message = insertMessage({
    conversationId: req.params.id,
    senderType,
    senderName,
    body,
    attachments
  });

  db.prepare("UPDATE conversations SET updated_at = ?, status = CASE WHEN ? = 'user' AND status = 'closed' THEN 'open' ELSE status END WHERE id = ?").run(now(), senderType, req.params.id);
  emitProject(req.projectId, "inbox:message", message);
  io.to(req.params.id).emit("message:new", message);
  emitProject(req.projectId, "conversation:updated", getConversationFull(req.params.id, req.projectId));

  res.status(201).json(message);
});

app.patch("/api/conversations/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body;

  if (!["open", "pending", "closed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const result = db.prepare(`
    UPDATE conversations SET status = ?, updated_at = ?
    WHERE id = ? AND project_id = ?
  `).run(status, now(), req.params.id, req.admin.project_id);

  if (result.changes === 0) return res.status(404).json({ error: "Conversation not found." });

  const full = getConversationFull(req.params.id, req.admin.project_id);
  emitProject(req.admin.project_id, "conversation:updated", full);
  res.json(full);
});

const teamWebhooks = require("./team-webhooks").createTeamWebhooks({ app, db, requireAdmin, requireWorkspaceAdmin });
const teamAi = require("./team-ai").createTeamAi({ app, db, requireAdmin, requireWorkspaceAdmin });

app.post("/api/conversations/:id/ai-draft", requireAdmin, async (req, res) => {
  const conversation = getConversationFull(req.params.id, req.admin.project_id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });

  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));

  if (!getPlanLimits(project.plan).aiDrafts) {
    return res.status(402).json({ error: "AI drafts are available on Growth and Partner plans." });
  }

  try { res.json(await teamAi.draft(req.admin.project_id, conversation)); }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

require("./billing").registerBilling({ app, db, requireAdmin, isOwner, now });

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/widget.js") return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

io.on("connection", socket => {
  function allowed(conversationId, credentials) {
    const admin = authenticateToken(credentials?.token);
    const project = admin ? { id: admin.project_id } : getProjectByWidgetKey(credentials?.widgetKey);
    return project && (admin || requireActivePlan(project).allowed) && db.prepare("SELECT id FROM conversations WHERE id = ? AND project_id = ?").get(conversationId, project.id);
  }
  socket.on("project:join", (payload, ack) => {
    const admin = authenticateToken(payload?.token);
    if (!admin || admin.project_id !== payload?.projectId) return ack?.({ error: "Unauthorized" });
    socket.data.sessionToken = payload.token;
    socket.join(`project:${admin.project_id}`);
    ack?.({ ok: true });
  });
  socket.on("conversation:join", (payload, ack) => {
    if (!allowed(payload?.conversationId, payload)) return ack?.({ error: "Unauthorized" });
    if (payload.token) socket.data.sessionToken = payload.token;
    socket.join(payload.conversationId);
    ack?.({ ok: true });
  });
  socket.on("conversation:leave", id => socket.leave(id));
  socket.on("project:leave", id => socket.leave(`project:${id}`));
});

function widgetScript() {
  return `
(function () {
  var script = document.currentScript;
  var widgetKey = script && (script.getAttribute("data-key") || script.dataset.key);
  var apiUrl = (script && (script.getAttribute("data-api") || script.dataset.api)) || new URL(script.src).origin;
  if (!widgetKey || document.getElementById("support-chat-platform-widget")) return;

  var root = document.createElement("div");
  root.id = "support-chat-platform-widget";
  document.body.appendChild(root);

  var state = { open: false, config: null, conversationId: localStorage.getItem("support-widget-conversation-" + widgetKey) || "", messages: [], draft: "", error: "", sending: false };
  var css = document.createElement("style");
  css.textContent = "#support-chat-platform-widget *{box-sizing:border-box;font-family:Arial,sans-serif}.scp-launcher{position:fixed;bottom:24px;width:62px;height:62px;border:0;border-radius:50%;z-index:2147483000;box-shadow:0 18px 50px rgba(15,23,42,.28);cursor:pointer}.scp-panel{position:fixed;bottom:98px;width:380px;max-width:calc(100vw - 28px);height:590px;max-height:calc(100vh - 122px);z-index:2147482999;border-radius:18px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.32);display:flex;flex-direction:column}.scp-head{padding:18px;color:#fff}.scp-head strong,.scp-head small{display:block}.scp-head small{opacity:.72;margin-top:4px}.scp-body{flex:1;background:#fff;color:#111827;overflow:auto;padding:16px;display:grid;align-content:start;gap:10px}.scp-msg{max-width:84%;padding:10px 12px;border-radius:14px;background:#eef2f7;line-height:1.4}.scp-msg.user{justify-self:end;color:#fff}.scp-form{background:#fff;border-top:1px solid #e5e7eb;padding:12px;display:grid;gap:8px}.scp-form input,.scp-form textarea{width:100%;border:1px solid #d1d5db;border-radius:10px;padding:10px;font:inherit}.scp-form textarea{min-height:74px;resize:vertical}.scp-form button{border:0;border-radius:10px;padding:11px 12px;color:#fff;font-weight:800;cursor:pointer}.scp-hidden{display:none}";
  document.head.appendChild(css);

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char];
    });
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ "Content-Type": "application/json", "X-Widget-Key": widgetKey }, options.headers || {});
    return fetch(apiUrl + path, options).then(function (res) { return res.json().then(function (data) { if (!res.ok) throw data; return data; }); });
  }

  function render() {
    var theme = (state.config && state.config.theme) || {};
    var side = theme.position === "left" ? "left" : "right";
    var accent = theme.accentColor || "#14b8a6";
    var panel = theme.panelColor || "#0b1220";
    var text = theme.textColor || "#f8fafc";
    root.innerHTML =
      '<button class="scp-launcher" style="' + side + ':24px;background:' + (theme.launcherColor || accent) + ';color:' + text + '" aria-label="Open support">Chat</button>' +
      '<section class="scp-panel ' + (state.open ? "" : "scp-hidden") + '" style="' + side + ':24px;background:' + panel + '">' +
        '<div class="scp-head" style="background:' + panel + ';color:' + text + '"><strong>' + escapeHtml(theme.brandName || "Support") + '</strong><small>' + escapeHtml(theme.replyTime || "We typically reply soon") + '</small></div>' +
        '<div class="scp-body">' + (state.messages.length ? state.messages.map(function (message) {
          return '<div class="scp-msg ' + escapeHtml(message.sender_type) + '" style="' + (message.sender_type === "user" ? "background:" + accent : "") + '">' + escapeHtml(message.body) + '</div>';
        }).join("") : '<div class="scp-msg">' + escapeHtml(theme.greeting || "Hi, how can we help?") + '</div>') + '</div>' +
        '<form class="scp-form">' + (!state.conversationId ? '<input name="xUsername" aria-label="Customer ID" required placeholder="X username or customer ID"><input name="email" aria-label="Email" type="email" placeholder="Email">' : '') + '<textarea name="message" aria-label="Message" required maxlength="10000" placeholder="Type your message...">' + escapeHtml(state.draft) + '</textarea>' + (state.error ? '<small role="alert" style="color:#b91c1c">' + escapeHtml(state.error) + '</small>' : '') + '<button ' + (state.sending ? 'disabled ' : '') + 'style="background:' + accent + '">' + (state.sending ? 'Sending…' : 'Send') + '</button></form>' +
      '</section>';

    root.querySelector(".scp-launcher").onclick = function () { state.open = !state.open; render(); };
    root.querySelector(".scp-form")?.addEventListener("submit", submitMessage);
    root.querySelector("textarea").oninput = function (event) { state.draft = event.target.value; };
  }

  setInterval(function () {
    if (!state.open || !state.conversationId) return;
    api("/api/conversations/" + state.conversationId).then(function (conversation) {
      if (JSON.stringify(state.messages) === JSON.stringify(conversation.messages)) return;
      var input = root.querySelector("textarea");
      var focused = document.activeElement === input;
      var caret = input?.selectionStart || 0;
      var draft = input?.value || "";
      state.messages = conversation.messages || [];
      render();
      root.querySelector("textarea").value = draft;
      if (focused) { root.querySelector("textarea").focus(); root.querySelector("textarea").setSelectionRange(caret, caret); }
      root.querySelector(".scp-body").scrollTop = root.querySelector(".scp-body").scrollHeight;
    }).catch(function () {});
  }, 3000);

  function submitMessage(event) {
    event.preventDefault();
    var form = event.target;
    var message = form.message.value.trim();
    if (!message || state.sending) return;
    state.sending = true; state.error = "";
    form.querySelector("button").disabled = true;
    var request = state.conversationId
      ? api("/api/conversations/" + state.conversationId + "/messages", { method: "POST", body: JSON.stringify({ senderType: "user", body: message, widgetKey: widgetKey }) })
      : api("/api/conversations", { method: "POST", body: JSON.stringify({ widgetKey: widgetKey, xUsername: form.xUsername.value, email: form.email.value, firstMessage: message, pageUrl: location.href, userAgent: navigator.userAgent }) });
    request.then(function (data) {
      if (data.id && data.messages) {
        state.conversationId = data.id;
        state.messages = data.messages;
        localStorage.setItem("support-widget-conversation-" + widgetKey, data.id);
      } else {
        state.messages.push(data);
      }
      state.sending = false; state.draft = ""; state.error = "";
      render();
    }).catch(function (error) { state.sending = false; state.error = error.error || "Connection interrupted. Your message is still here — please try sending again."; render(); });
  }

  api("/api/widget/config?widgetKey=" + encodeURIComponent(widgetKey)).then(function (config) {
    state.config = config;
    if (state.conversationId) {
      api("/api/conversations/" + state.conversationId + "?widgetKey=" + encodeURIComponent(widgetKey)).then(function (conversation) {
        state.messages = conversation.messages || [];
        render();
      }).catch(render);
    } else {
      render();
    }
  }).catch(function () { root.remove(); });
}());
`;
}

server.listen(PORT, () => {
  const project = getDefaultProject();
  console.log(`${PRODUCT_NAME} backend running on http://localhost:${PORT}`);
  console.log(`Default widget key: ${project.widgetKey}`);
});
