require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
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

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: CLIENT_URLS, credentials: true }));
app.use(express.json({ limit: "12mb" }));

const io = new Server(server, {
  cors: { origin: CLIENT_URLS, methods: ["GET", "POST"] }
});

const db = new Database(DATABASE_PATH);

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
    body: "Could you send a relevant screenshot or screen recording of what you are seeing? Please hide any private keys, seed phrases, or sensitive payment details before sharing.",
    auto_send: 0,
    sort_order: 30
  },
  {
    id: "payment",
    title: "Payment check",
    body: "Please share your payment transaction hash or USDC transfer reference, plus the wallet you paid from, so we can match it to your order.",
    auto_send: 0,
    sort_order: 40
  },
  {
    id: "eta",
    title: "Set ETA",
    body: "We are checking this now. If everything matches, we will update you with the next step and timing shortly.",
    auto_send: 0,
    sort_order: 50
  }
];

db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT,
  wallet TEXT,
  x_username TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  assigned_to TEXT,
  page_url TEXT,
  screenshot_url TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  attachments_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS automation_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  auto_send INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some(existingColumn => existingColumn.name === column);

  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

ensureColumn("customers", "x_username", "TEXT DEFAULT ''");
ensureColumn("conversations", "screenshot_url", "TEXT DEFAULT ''");
ensureColumn("messages", "attachments_json", "TEXT DEFAULT '[]'");

const seedAutomationTemplate = db.prepare(`
  INSERT OR IGNORE INTO automation_templates (id, title, body, auto_send, sort_order, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

for (const template of DEFAULT_AUTOMATIONS) {
  seedAutomationTemplate.run(template.id, template.title, template.body, template.auto_send, template.sort_order, now());
}

function now() {
  return new Date().toISOString();
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
    attachments_json: undefined
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

function getAutomationTemplates() {
  return db.prepare(`
    SELECT * FROM automation_templates
    ORDER BY sort_order ASC, title ASC
  `).all().map(formatAutomation);
}

function insertMessage({ conversationId, senderType, senderName, body, attachments = [] }) {
  const createdAt = now();
  const cleanBody = typeof body === "string" ? body.trim() : "";
  const message = {
    id: uuid(),
    conversation_id: conversationId,
    sender_type: senderType,
    sender_name: senderName || (senderType === "agent" ? "FMAX Support" : "Customer"),
    body: cleanBody,
    attachments,
    created_at: createdAt
  };

  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_type, sender_name, body, attachments_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    message.conversation_id,
    message.sender_type,
    message.sender_name,
    message.body,
    JSON.stringify(message.attachments),
    message.created_at
  );

  return message;
}

async function sendDiscordAlert(conversation, message) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `New support conversation\nCustomer: ${conversation.name || "Unknown"}\nEmail: ${conversation.email || "N/A"}\nX username: ${conversation.xUsername || "N/A"}\nWallet: ${conversation.wallet || "N/A"}\nMessage: ${message}`
      })
    });
  } catch (error) {
    console.error("Discord webhook failed:", error.message);
  }
}

function getConversationFull(conversationId) {
  const conversation = db.prepare(`
    SELECT c.*, cu.name, cu.email, cu.wallet, cu.x_username
    FROM conversations c
    JOIN customers cu ON cu.id = c.customer_id
    WHERE c.id = ?
  `).get(conversationId);

  if (!conversation) return null;

  const messages = db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(conversationId).map(formatMessage);

  return { ...conversation, messages };
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/automations", (req, res) => {
  res.json(getAutomationTemplates());
});

app.put("/api/automations", (req, res) => {
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

  const invalid = normalized.some(template => !template.title || !template.body);
  if (invalid) {
    return res.status(400).json({ error: "Each automation needs a title and message." });
  }

  const saveTemplates = db.transaction(() => {
    db.prepare("DELETE FROM automation_templates").run();

    const insert = db.prepare(`
      INSERT INTO automation_templates (id, title, body, auto_send, sort_order, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const template of normalized) {
      insert.run(template.id, template.title, template.body, template.auto_send, template.sort_order, now());
    }
  });

  saveTemplates();
  res.json(getAutomationTemplates());
});

app.post("/api/conversations", async (req, res) => {
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
    INSERT INTO customers (id, name, email, wallet, x_username, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(customerId, name || "", email || "", wallet || "", xUsername.trim(), now());

  db.prepare(`
    INSERT INTO conversations (id, customer_id, status, page_url, screenshot_url, user_agent, created_at, updated_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?)
  `).run(conversationId, customerId, pageUrl || "", screenshotUrl || "", userAgent || "", now(), now());

  insertMessage({
    conversationId,
    senderType: "user",
    senderName: name || "Customer",
    body: firstMessage,
    attachments
  });

  const autoReplies = db.prepare(`
    SELECT * FROM automation_templates
    WHERE auto_send = 1
    ORDER BY sort_order ASC, title ASC
  `).all();

  for (const template of autoReplies) {
    insertMessage({
      conversationId,
      senderType: "agent",
      senderName: "FMAX Support",
      body: template.body
    });
  }

  const full = getConversationFull(conversationId);

  io.emit("conversation:new", full);
  await sendDiscordAlert({ name, email, wallet, xUsername }, firstMessage.trim());

  res.status(201).json(full);
});

app.get("/api/conversations", (req, res) => {
  const status = req.query.status;

  const query = status
    ? `
      SELECT c.*, cu.name, cu.email, cu.wallet,
        cu.x_username,
        (SELECT CASE WHEN body != '' THEN body ELSE '[Image attachment]' END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN customers cu ON cu.id = c.customer_id
      WHERE c.status = ?
      ORDER BY c.updated_at DESC
    `
    : `
      SELECT c.*, cu.name, cu.email, cu.wallet,
        cu.x_username,
        (SELECT CASE WHEN body != '' THEN body ELSE '[Image attachment]' END FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
      FROM conversations c
      JOIN customers cu ON cu.id = c.customer_id
      ORDER BY c.updated_at DESC
    `;

  const rows = status
    ? db.prepare(query).all(status)
    : db.prepare(query).all();

  res.json(rows);
});

app.get("/api/conversations/:id", (req, res) => {
  const full = getConversationFull(req.params.id);
  if (!full) return res.status(404).json({ error: "Conversation not found." });
  res.json(full);
});

app.post("/api/conversations/:id/messages", (req, res) => {
  const { senderType, senderName, body } = req.body;
  const attachments = cleanAttachments(req.body.attachments);

  if (!["user", "agent"].includes(senderType)) {
    return res.status(400).json({ error: "senderType must be user or agent." });
  }

  if ((!body || body.trim().length < 1) && attachments.length === 0) {
    return res.status(400).json({ error: "Message body or attachment is required." });
  }

  const conversation = db.prepare("SELECT id FROM conversations WHERE id = ?").get(req.params.id);
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
  io.emit("conversation:updated", getConversationFull(req.params.id));

  res.status(201).json(message);
});

app.patch("/api/conversations/:id/status", (req, res) => {
  const { status } = req.body;

  if (!["open", "pending", "closed"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const result = db.prepare(`
    UPDATE conversations SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(status, now(), req.params.id);

  if (result.changes === 0) return res.status(404).json({ error: "Conversation not found." });

  const full = getConversationFull(req.params.id);
  io.emit("conversation:updated", full);

  res.json(full);
});

io.on("connection", socket => {
  socket.on("conversation:join", conversationId => {
    socket.join(conversationId);
  });

  socket.on("conversation:leave", conversationId => {
    socket.leave(conversationId);
  });
});

server.listen(PORT, () => {
  console.log(`Support backend running on http://localhost:${PORT}`);
});
