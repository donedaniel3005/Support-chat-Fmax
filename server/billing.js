const crypto = require('node:crypto');
const { unwrapWebhook } = require('@whop/sdk/helpers');
const { publicApplicationUrl } = require('./launch-config');

function registerBilling({ app, db, requireAdmin, isOwner, now, fetchApi = fetch, env = process.env }) {
  const variants = { starter: env.WHOP_STARTER_PLAN_ID, growth: env.WHOP_GROWTH_PLAN_ID, partner: env.WHOP_PARTNER_PLAN_ID };
  const configured = Boolean(env.WHOP_API_KEY && env.WHOP_ACCOUNT_ID && env.WHOP_WEBHOOK_SECRET);
  const checkoutReady = configured && (env.WHOP_ENVIRONMENT !== 'production' || Boolean(publicApplicationUrl(env)));
  const origin = env.WHOP_ENVIRONMENT === 'production' ? 'https://api.whop.com/api/v1' : 'https://sandbox-api.whop.com/api/v1';
  db.exec(`CREATE TABLE IF NOT EXISTS billing_orders (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, plan TEXT NOT NULL, variant_id TEXT NOT NULL, checkout_url TEXT, status TEXT DEFAULT 'pending', payment_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, error TEXT, created_at TEXT NOT NULL, next_attempt_at INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS billing_subscriptions (project_id TEXT PRIMARY KEY, membership_id TEXT NOT NULL UNIQUE, order_created_at TEXT NOT NULL, plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_audit (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL);`);
  async function whop(url, body, idempotencyKey) {
    const response = await fetchApi(origin + url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${env.WHOP_API_KEY}`, 'Content-Type': 'application/json', 'Api-Version-Date': '2026-11-14-1', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Whop API returned ${response.status}`);
    return response.json();
  }
  function ownerOnly(req, res, next) { if (!isOwner(req.admin)) return res.status(403).json({ error: 'Owner access required.' }); next(); }
  app.get('/api/billing/options', (req, res) => res.json({ provider: 'whop', plans: Object.fromEntries(Object.keys(variants).map(plan => [plan, checkoutReady && Boolean(variants[plan])])) }));
  app.post('/api/billing/checkout', requireAdmin, async (req, res) => {
    if (req.admin.role !== 'admin') return res.status(403).json({ error: 'Ask your workspace admin to manage billing.' });
    const plan = String(req.body.plan || '');
    if (!variants[plan] || !checkoutReady) return res.status(503).json({ error: 'Checkout is not available for this plan yet. Contact support.' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO billing_orders (id, project_id, plan, variant_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, req.admin.project_id, plan, variants[plan], now());
    try {
      const checkout = await whop('/checkout_configurations', { account_id: env.WHOP_ACCOUNT_ID, variant_id: variants[plan], metadata: { support_order_id: id }, redirect_url: new URL('/admin?checkout=returned', env.APP_URL || env.RENDER_EXTERNAL_URL || env.CLIENT_URL || 'http://localhost:5173').href }, id);
      const url = new URL(checkout.purchase_url);
      if (url.protocol !== 'https:' || !['whop.com', 'sandbox.whop.com'].includes(url.hostname)) throw new Error('Unexpected checkout destination');
      db.prepare('UPDATE billing_orders SET checkout_url = ? WHERE id = ?').run(url.href, id);
      res.json({ url: url.href });
    } catch { db.prepare("UPDATE billing_orders SET status = 'checkout_failed' WHERE id = ?").run(id); res.status(502).json({ error: 'Could not open checkout. Please try again or contact support.' }); }
  });
  app.post('/api/webhooks/whop', (req, res) => {
    if (!env.WHOP_WEBHOOK_SECRET) return res.status(503).json({ error: 'Webhook not configured.' });
    let event;
    try { event = unwrapWebhook(req.rawBody.toString('utf8'), { headers: req.headers, key: env.WHOP_WEBHOOK_SECRET }); }
    catch { return res.status(401).json({ error: 'Invalid signature.' }); }
    const id = req.headers['webhook-id'];
    if (!id || event.account_id !== env.WHOP_ACCOUNT_ID || event.api_version !== 'v1' || event.api_version_date !== '2026-11-14-1') return res.status(400).json({ error: 'Unexpected webhook account or API version.' });
    db.prepare('INSERT OR IGNORE INTO billing_events (id, type, payload, created_at) VALUES (?, ?, ?, ?)').run(id, event.type, JSON.stringify(event), now());
    res.json({ ok: true });
    setImmediate(() => void processEvents());
  });
  async function handle(event) {
    if (event.type === 'payment.succeeded') {
      const payment = await whop('/payments/' + encodeURIComponent(event.data.id));
      if (payment.account_id !== env.WHOP_ACCOUNT_ID || payment.substatus !== 'succeeded') throw new Error('Payment is not confirmed as succeeded');
      const order = db.prepare('SELECT * FROM billing_orders WHERE id = ?').get(payment.metadata?.support_order_id || '');
      if (!order || payment.variant_id !== order.variant_id) throw new Error('Payment could not be matched to a workspace order');
      if (!payment.membership_id) throw new Error('Subscription membership is missing; owner review required');
      const membership = await whop('/memberships/' + encodeURIComponent(payment.membership_id));
      if (membership.account?.id !== env.WHOP_ACCOUNT_ID || membership.variant_id !== order.variant_id || !['active', 'trialing', 'completed'].includes(membership.status)) throw new Error('Membership does not grant access');
      const current = db.prepare('SELECT * FROM billing_subscriptions WHERE project_id = ?').get(order.project_id);
      if (current && current.order_created_at > order.created_at) return;
      db.transaction(() => {
        db.prepare("UPDATE projects SET plan = ?, billing_status = 'owner_approved', updated_at = ? WHERE id = ?").run(order.plan, now(), order.project_id);
        db.prepare("UPDATE billing_orders SET status = 'paid', payment_id = ? WHERE id = ?").run(payment.id, order.id);
        db.prepare('INSERT INTO billing_subscriptions VALUES (?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET membership_id = excluded.membership_id, order_created_at = excluded.order_created_at, plan = excluded.plan').run(order.project_id, membership.id, order.created_at, order.plan);
      })();
    } else if (['membership.updated', 'membership.activated'].includes(event.type)) {
      const subscription = db.prepare('SELECT * FROM billing_subscriptions WHERE membership_id = ?').get(event.data.id);
      if (!subscription) return;
      const membership = await whop('/memberships/' + encodeURIComponent(event.data.id));
      if (membership.account?.id !== env.WHOP_ACCOUNT_ID || membership.variant_id !== variants[subscription.plan]) throw new Error('Unexpected membership');
      const active = ['active', 'trialing', 'completed', 'past_due'].includes(membership.status);
      db.prepare("UPDATE projects SET plan = ?, updated_at = ? WHERE id = ?").run(active ? subscription.plan : 'free', now(), subscription.project_id);
    }
  }
  let processing = false, stopped = false;
  async function processEvents() {
    if (processing || stopped || !configured) return;
    processing = true;
    try {
      const events = db.prepare("SELECT * FROM billing_events WHERE status IN ('pending','retry') AND next_attempt_at <= ? ORDER BY created_at LIMIT 10").all(Date.now());
      for (const row of events) {
        try { await handle(JSON.parse(row.payload)); db.prepare("UPDATE billing_events SET status = 'complete', error = NULL WHERE id = ?").run(row.id); }
        catch (error) { const attempts = row.attempts + 1; db.prepare('UPDATE billing_events SET status = ?, attempts = ?, error = ?, next_attempt_at = ? WHERE id = ?').run(attempts >= 8 ? 'needs_review' : 'retry', attempts, error.message.slice(0, 240), Date.now() + Math.min(3600000, 15000 * 2 ** attempts), row.id); }
      }
    } finally { processing = false; }
  }
  app.get('/api/owner/billing', requireAdmin, ownerOnly, (req, res) => res.json({ whop: { configured, environment: env.WHOP_ENVIRONMENT === 'production' ? 'production' : 'sandbox' }, workspaces: db.prepare('SELECT id, name, plan, billing_status FROM projects ORDER BY created_at DESC').all(), events: db.prepare('SELECT id, type, status, attempts, error, created_at FROM billing_events ORDER BY created_at DESC LIMIT 100').all(), orders: db.prepare('SELECT id, project_id, plan, status, payment_id, created_at FROM billing_orders ORDER BY created_at DESC LIMIT 100').all(), audit: db.prepare('SELECT * FROM billing_audit ORDER BY created_at DESC LIMIT 50').all() }));
  app.patch('/api/owner/workspaces/:id/billing', requireAdmin, ownerOnly, (req, res) => {
    const { plan, status, note } = req.body;
    if (!['free', 'starter', 'growth', 'partner'].includes(plan) || !['owner_approved', 'paused'].includes(status) || typeof note !== 'string' || !note.trim()) return res.status(400).json({ error: 'Choose a plan, access state, and a reason for the manual change.' });
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Workspace not found.' });
    db.transaction(() => {
      db.prepare('UPDATE projects SET plan = ?, billing_status = ?, updated_at = ? WHERE id = ?').run(plan, status, now(), req.params.id);
      db.prepare('INSERT INTO billing_audit VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), req.params.id, req.admin.email, `${plan}/${status}: ${note.slice(0,500)}`, now());
    })();
    res.json({ ok: true });
  });
  app.post('/api/owner/billing/events/:id/retry', requireAdmin, ownerOnly, (req, res) => {
    db.prepare("UPDATE billing_events SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE id = ? AND status != 'complete'").run(req.params.id);
    res.json({ ok: true }); setImmediate(() => void processEvents());
  });
  const timer = setInterval(() => void processEvents(), 15000); timer.unref();
  return { handle, processEvents, stop: () => { stopped = true; clearInterval(timer); } };
}
module.exports = { registerBilling };
