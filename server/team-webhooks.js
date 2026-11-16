const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const https = require('node:https');
const EVENTS = ['conversation.created', 'conversation.updated', 'message.created'];
function publicV4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) || (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
}
function validateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || url.hostname.length > 253 || value.length > 2048) throw new Error('Use a public HTTPS URL on port 443 without credentials or a fragment.');
  if (url.hostname === 'localhost' || /\.(local|localhost|internal)$/i.test(url.hostname)) throw new Error('Private destinations are not allowed.');
  return url;
}
async function deliver(urlString, payload, headers) {
  const url = validateUrl(urlString);
  // Resolve and pin one public IPv4 address for this connection, including retries.
  // This prevents DNS rebinding; redirects and IPv6-only destinations are unsupported.
  const addresses = await dns.lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(item => !publicV4(item.address))) throw new Error('private destination');
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) }, lookup: (_host, options, cb) => options.all ? cb(null, [addresses[0]]) : cb(null, addresses[0].address, 4) }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 300);
    });
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.on('error', reject); req.end(payload);
  });
}
function createTeamWebhooks({ app, db, requireAdmin, requireWorkspaceAdmin, send = deliver, env = process.env }) {
  const secrets = require('./integration-secrets').secretStore(env);
  db.exec(`CREATE TABLE IF NOT EXISTS team_webhooks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL, secret TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS team_webhook_deliveries (id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, project_id TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER DEFAULT 0, state TEXT DEFAULT 'pending', next_at INTEGER DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS team_webhook_due ON team_webhook_deliveries(state, next_at);`);
  const list = project => db.prepare('SELECT id,url,events FROM team_webhooks WHERE project_id = ?').all(project).map(row => ({ ...row, events: JSON.parse(row.events) }));
  app.get('/api/projects/current/webhooks', requireAdmin, requireWorkspaceAdmin, (req, res) => res.json({ webhooks: list(req.admin.project_id), deliveries: db.prepare('SELECT id,webhook_id,attempts,state,created_at FROM team_webhook_deliveries WHERE project_id = ? ORDER BY created_at DESC LIMIT 30').all(req.admin.project_id) }));
  app.post('/api/projects/current/webhooks', requireAdmin, requireWorkspaceAdmin, (req, res) => {
    if (!secrets.ready) return res.status(503).json({ error: 'Secure integration storage must be configured first.' });
    try {
      const url = validateUrl(String(req.body.url || '')).href;
      const events = [...new Set(req.body.events || [])];
      if (!events.length || events.some(e => !EVENTS.includes(e))) throw new Error('Select at least one supported event.');
      if (list(req.admin.project_id).length >= 5) throw new Error('A workspace can have up to five webhooks.');
      const id = crypto.randomUUID(), secret = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO team_webhooks VALUES (?,?,?,?,?)').run(id, req.admin.project_id, url, JSON.stringify(events), secrets.seal(secret));
      res.status(201).json({ id, secret, webhooks: list(req.admin.project_id) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.delete('/api/projects/current/webhooks/:id', requireAdmin, requireWorkspaceAdmin, (req, res) => {
    db.transaction(() => {
      db.prepare('DELETE FROM team_webhooks WHERE id = ? AND project_id = ?').run(req.params.id, req.admin.project_id);
      db.prepare('DELETE FROM team_webhook_deliveries WHERE webhook_id = ? AND project_id = ?').run(req.params.id, req.admin.project_id);
    })();
    res.json({ webhooks: list(req.admin.project_id) });
  });
  let running = false;
  async function processQueue() {
    if (running) return;
    running = true;
    try {
      const rows = db.prepare("SELECT d.*, w.url, w.secret FROM team_webhook_deliveries d JOIN team_webhooks w ON w.id = d.webhook_id WHERE d.state = 'pending' AND d.next_at <= ? LIMIT 10").all(Date.now());
      for (const row of rows) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        let ok = false;
        try {
          const signature = crypto.createHmac('sha256', secrets.unseal(row.secret)).update(`${timestamp}.${row.payload}`).digest('hex');
          ok = await send(row.url, row.payload, { 'Content-Type': 'application/json', 'X-Support-Event-Id': row.id, 'X-Support-Timestamp': timestamp, 'X-Support-Signature': `v1=${signature}` }); } catch {}
        const attempts = row.attempts + 1;
        db.prepare('UPDATE team_webhook_deliveries SET attempts=?, state=?, next_at=? WHERE id=?').run(attempts, ok ? 'delivered' : attempts >= 6 ? 'failed' : 'pending', Date.now() + Math.min(3600000, 15000 * 2 ** attempts), row.id);
      }
      db.prepare("DELETE FROM team_webhook_deliveries WHERE state != 'pending' AND created_at < ?").run(new Date(Date.now() - 7 * 86400000).toISOString());
    } finally { running = false; }
  }
  const timer = setInterval(() => { processQueue().catch(() => {}); }, 15000); timer.unref();
  function enqueue(projectId, type, data) {
    for (const hook of list(projectId).filter(h => h.events.includes(type))) {
      if (db.prepare("SELECT COUNT(*) AS n FROM team_webhook_deliveries WHERE webhook_id = ? AND state = 'pending'").get(hook.id).n >= 1000) continue;
      const id = crypto.randomUUID(), created = new Date().toISOString();
      const payload = JSON.stringify({ id, type, created_at: created, workspace_id: projectId, data });
      db.prepare('INSERT INTO team_webhook_deliveries(id,webhook_id,project_id,payload,created_at) VALUES (?,?,?,?,?)').run(id, hook.id, projectId, payload, created);
    }
  }
  return { enqueue, processQueue, stop: () => clearInterval(timer) };
}
module.exports = { createTeamWebhooks, publicV4, validateUrl };
