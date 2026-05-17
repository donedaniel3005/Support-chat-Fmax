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

const PORT = process.env.PORT || 4000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const CLIENT_URLS = (process.env.CLIENT_URLS || CLIENT_URL)
  .split(",")
  .map(url => url.trim())
  .filter(Boolean);
const DATABASE_PATH = process.env.DATABASE_PATH || "./support.sqlite";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin12345";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const PRODUCT_NAME = "24/7Support";

const app = express();
const server = http.createServer(app);
const db = new Database(DATABASE_PATH);
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "12mb" }));

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
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT DEFAULT '',
  widget_key TEXT NOT NULL UNIQUE,
  secret_key TEXT NOT NULL UNIQUE,
  theme_json TEXT NOT NULL,
  ai_enabled INTEGER DEFAULT 1,
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
`);

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
  return {
    brandName: String(theme.brandName || DEFAULT_THEME.brandName).slice(0, 80),
    accentColor: String(theme.accentColor || DEFAULT_THEME.accentColor).slice(0, 24),
    launcherColor: String(theme.launcherColor || DEFAULT_THEME.launcherColor).slice(0, 24),
    panelColor: String(theme.panelColor || DEFAULT_THEME.panelColor).slice(0, 24),
    textColor: String(theme.textColor || DEFAULT_THEME.textColor).slice(0, 24),
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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
  req.project = project;
  req.projectId = project.id;
  next();
}

function requireWidgetProject(req, res, next) {
  const widgetKey = req.headers["x-widget-key"] || req.query.widgetKey || req.body.widgetKey;
  const project = getProjectByWidgetKey(widgetKey);
  if (!project) return res.status(401).json({ error: "Valid widget key required." });
  req.project = project;
  req.projectId = project.id;
  next();
}

function emitProject(projectId, eventName, payload) {
  io.to(`project:${projectId}`).emit(eventName, payload);
}

function heuristicAiReply(conversation) {
  const latestUserMessage = [...conversation.messages].reverse().find(message => message.sender_type === "user");
  const body = latestUserMessage?.body?.toLowerCase() || "";

  if (body.includes("payment") || body.includes("paid") || body.includes("transaction")) {
    return "Thanks for the payment details. Please send the transaction hash or payment reference and the wallet or email used so we can match it to your order.";
  }

  if (body.includes("login") || body.includes("password") || body.includes("account")) {
    return "Thanks for flagging this. Please confirm the email or username on the account, the exact error shown, and whether you have already tried resetting your password.";
  }

  if (body.includes("bug") || body.includes("error") || body.includes("not working")) {
    return "Thanks, we can help check this. Please share the page URL, what you expected to happen, what happened instead, and a screenshot if possible.";
  }

  return "Thanks for reaching out. I can help with this. Please share any order reference, account email, screenshots, or steps that led to the issue so we can investigate quickly.";
}

async function generateAiReply(conversation) {
  if (!OPENAI_API_KEY) return heuristicAiReply(conversation);

  const transcript = conversation.messages
    .slice(-12)
    .map(message => `${message.sender_type === "agent" ? "Support" : "Customer"}: ${message.body}`)
    .join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: "Write a concise, friendly customer-support reply. Ask for only the missing details needed to proceed. Do not promise refunds, legal outcomes, or actions outside support policy." },
          { role: "user", content: transcript }
        ],
        temperature: 0.4
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || heuristicAiReply(conversation);
  } catch {
    return heuristicAiReply(conversation);
  }
}

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
    user: { id: user.id, email: user.email, role: user.role, projectId: user.project_id },
    project
  });
});

app.get("/api/auth/me", requireAdmin, (req, res) => {
  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));
  res.json({
    user: { id: req.admin.user_id, email: req.admin.email, role: req.admin.role, projectId: req.admin.project_id },
    project
  });
});

app.post("/api/auth/logout", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM auth_sessions WHERE token = ?").run(getBearerToken(req));
  res.json({ ok: true });
});

app.get("/api/widget/config", requireWidgetProject, (req, res) => {
  res.json({
    projectId: req.project.id,
    brandName: PRODUCT_NAME,
    theme: { ...req.project.theme, brandName: PRODUCT_NAME },
    aiEnabled: req.project.aiEnabled
  });
});

app.get("/widget.js", (req, res) => {
  res.type("application/javascript").send(widgetScript());
});

app.get("/api/projects/current", requireAdmin, (req, res) => {
  res.json(formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id)));
});

app.put("/api/projects/current", requireAdmin, (req, res) => {
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

app.post("/api/projects/current/rotate-key", requireAdmin, (req, res) => {
  const widgetKey = randomKey("widget");
  db.prepare("UPDATE projects SET widget_key = ?, updated_at = ? WHERE id = ?").run(widgetKey, now(), req.admin.project_id);
  res.json(formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id)));
});

app.get("/api/automations", requireAdmin, (req, res) => {
  res.json(getAutomationTemplates(req.admin.project_id));
});

app.put("/api/automations", requireAdmin, (req, res) => {
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

  if (!firstMessage || firstMessage.trim().length < 1) {
    return res.status(400).json({ error: "First message is required." });
  }

  if (!xUsername || xUsername.trim().length < 1) {
    return res.status(400).json({ error: "X username is required." });
  }

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
  await sendDiscordAlert({ projectName: req.project.name, name, email, xUsername }, firstMessage.trim());

  res.status(201).json(full);
});

app.get("/api/conversations", requireAdmin, (req, res) => {
  const status = req.query.status;

  const query = status
    ? `
      SELECT c.*, cu.name, cu.email, cu.wallet, cu.x_username,
        (SELECT CASE WHEN body != '' THEN body ELSE '[Image attachment]' END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN customers cu ON cu.id = c.customer_id
      WHERE c.project_id = ? AND c.status = ?
      ORDER BY c.updated_at DESC
    `
    : `
      SELECT c.*, cu.name, cu.email, cu.wallet, cu.x_username,
        (SELECT CASE WHEN body != '' THEN body ELSE '[Image attachment]' END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN customers cu ON cu.id = c.customer_id
      WHERE c.project_id = ?
      ORDER BY c.updated_at DESC
    `;

  const rows = status
    ? db.prepare(query).all(req.admin.project_id, status)
    : db.prepare(query).all(req.admin.project_id);

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

  if ((!body || body.trim().length < 1) && attachments.length === 0) {
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

  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), req.params.id);
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

app.post("/api/conversations/:id/ai-draft", requireAdmin, async (req, res) => {
  const conversation = getConversationFull(req.params.id, req.admin.project_id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found." });

  const project = formatProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.admin.project_id));
  if (!project.aiEnabled) return res.status(400).json({ error: "AI support is disabled for this project." });

  const draft = await generateAiReply(conversation);
  res.json({ draft, provider: OPENAI_API_KEY ? "openai" : "local-rule" });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/widget.js") return next();
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
}

io.on("connection", socket => {
  socket.on("project:join", projectId => {
    socket.join(`project:${projectId}`);
  });

  socket.on("conversation:join", conversationId => {
    socket.join(conversationId);
  });

  socket.on("conversation:leave", conversationId => {
    socket.leave(conversationId);
  });
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

  var state = { open: false, config: null, conversationId: localStorage.getItem("support-widget-conversation-" + widgetKey) || "", messages: [] };
  var css = document.createElement("style");
  css.textContent = ".scp-launcher{position:fixed;bottom:24px;width:62px;height:62px;border:0;border-radius:50%;z-index:2147483000;box-shadow:0 18px 50px rgba(15,23,42,.28);cursor:pointer}.scp-panel{position:fixed;bottom:98px;width:380px;max-width:calc(100vw - 28px);height:590px;max-height:calc(100vh - 122px);z-index:2147482999;border-radius:18px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.32);display:flex;flex-direction:column}.scp-head{padding:18px;color:#fff}.scp-head strong,.scp-head small{display:block}.scp-head small{opacity:.72;margin-top:4px}.scp-body{flex:1;background:#fff;color:#111827;overflow:auto;padding:16px;display:grid;align-content:start;gap:10px}.scp-msg{max-width:84%;padding:10px 12px;border-radius:14px;background:#eef2f7;line-height:1.4}.scp-msg.user{justify-self:end;color:#fff}.scp-form{background:#fff;border-top:1px solid #e5e7eb;padding:12px;display:grid;gap:8px}.scp-form input,.scp-form textarea{width:100%;border:1px solid #d1d5db;border-radius:10px;padding:10px;font:inherit}.scp-form textarea{min-height:74px;resize:vertical}.scp-form button{border:0;border-radius:10px;padding:11px 12px;color:#fff;font-weight:800;cursor:pointer}.scp-hidden{display:none}";
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
        '<form class="scp-form">' + (!state.conversationId ? '<input name="xUsername" required placeholder="X username or customer ID"><input name="email" type="email" placeholder="Email">' : '') + '<textarea name="message" required placeholder="Type your message..."></textarea><button style="background:' + accent + '">Send</button></form>' +
      '</section>';

    root.querySelector(".scp-launcher").onclick = function () { state.open = !state.open; render(); };
    root.querySelector(".scp-form")?.addEventListener("submit", submitMessage);
  }

  function submitMessage(event) {
    event.preventDefault();
    var form = event.target;
    var message = form.message.value.trim();
    if (!message) return;
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
      render();
    }).catch(function (error) { alert(error.error || "Could not send message."); });
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
  }).catch(function () {
    state.config = { theme: {} };
    render();
  });
}());
`;
}

server.listen(PORT, () => {
  const project = getDefaultProject();
  console.log(`${PRODUCT_NAME} backend running on http://localhost:${PORT}`);
  console.log(`Default widget key: ${project.widgetKey}`);
});
