const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { registerBilling } = require('../server/billing');

test('Whop: signed events, tenant mapping, idempotency, current-state access and manual fallback', async t => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,plan TEXT,billing_status TEXT,created_at TEXT,updated_at TEXT); INSERT INTO projects VALUES ('acme','Acme','free','owner_approved','2026-01-01','2026-01-01'); INSERT INTO projects VALUES ('other','Other','free','owner_approved','2026-01-01','2026-01-01');");
  const routes = new Map();
  const app = Object.fromEntries(['get','post','patch'].map(method => [method, (url, ...handlers) => routes.set(method + ':' + url, handlers.at(-1))]));
  const secret = 'ws_' + 'a'.repeat(64);
  const env = { WHOP_API_KEY: 'test', WHOP_ACCOUNT_ID: 'biz_test', WHOP_WEBHOOK_SECRET: secret, WHOP_GROWTH_PLAN_ID: 'plan_growth', APP_URL: 'https://support.example', WHOP_ENVIRONMENT: 'sandbox' };
  let membershipStatus = 'active', paymentStatus = 'succeeded', metadata = { support_order_id: 'order-1' }, calls = [];
  const billing = registerBilling({ app, db, requireAdmin: () => {}, isOwner: admin => admin?.owner, now: () => new Date().toISOString(), env,
    fetchApi: async (url, options) => {
      calls.push({ url, options });
      let data;
      if (url.endsWith('/checkout_configurations')) data = { purchase_url: 'https://sandbox.whop.com/checkout/ch_test/' };
      else if (url.includes('/payments/')) data = { id: 'pay_test', substatus: paymentStatus, account_id: 'biz_test', variant_id: 'plan_growth', membership_id: 'mem_test', metadata };
      else data = { id: 'mem_test', account: { id: 'biz_test' }, variant_id: 'plan_growth', status: membershipStatus };
      return { ok: true, json: async () => data };
    }
  });
  t.after(() => { billing.stop(); db.close(); });
  function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
  const orderTime = new Date().toISOString();
  db.prepare('INSERT INTO billing_orders(id,project_id,plan,variant_id,created_at) VALUES (?,?,?,?,?)').run('order-1','acme','growth','plan_growth',orderTime);
  function deliver(id, type = 'payment.succeeded', extra = {}) {
    const raw = JSON.stringify({ id, type, account_id: 'biz_test', api_version: 'v1', api_version_date: '2026-11-14-1', data: { id: type === 'payment.succeeded' ? 'pay_test' : 'mem_test' }, ...extra });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', secret).update(id + '.' + timestamp + '.' + raw).digest('base64');
    const req = { rawBody: Buffer.from(raw), headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': 'v1,' + signature } };
    const res = response(); routes.get('post:/api/webhooks/whop')(req,res); return { req,res };
  }
  const initial = deliver('msg_one'); assert.equal(initial.res.code,200);
  await billing.processEvents();
  assert.equal(db.prepare("SELECT plan FROM projects WHERE id='acme'").get().plan,'growth');
  assert.equal(db.prepare("SELECT plan FROM projects WHERE id='other'").get().plan,'free');
  assert.equal(db.prepare("SELECT status FROM billing_orders WHERE id='order-1'").get().status,'paid');
  deliver('msg_one'); await billing.processEvents();
  assert.equal(db.prepare('SELECT count(*) AS n FROM billing_events').get().n,1);
  const tampered = response(); routes.get('post:/api/webhooks/whop')({ ...initial.req, rawBody: Buffer.from('{}') }, tampered); assert.equal(tampered.code,401);
  assert.equal(deliver('wrong_account','payment.succeeded',{ account_id: 'biz_wrong' }).res.code,400);
  membershipStatus = 'canceled'; deliver('msg_two','membership.updated'); await billing.processEvents();
  assert.equal(db.prepare("SELECT plan FROM projects WHERE id='acme'").get().plan,'free');
  membershipStatus = 'active'; deliver('msg_three','membership.updated'); await billing.processEvents();
  assert.equal(db.prepare("SELECT plan FROM projects WHERE id='acme'").get().plan,'growth');
  metadata = {}; deliver('msg_unmatched'); await billing.processEvents();
  assert.equal(db.prepare("SELECT status FROM billing_events WHERE id='msg_unmatched'").get().status,'retry');
  const manual = response(); routes.get('patch:/api/owner/workspaces/:id/billing')({ params: { id: 'other' }, admin: { email: 'owner@example.com' }, body: { plan: 'starter', status: 'owner_approved', note: 'Verified pay_manual in Whop' } }, manual);
  assert.equal(manual.code,200); assert.equal(db.prepare("SELECT plan FROM projects WHERE id='other'").get().plan,'starter'); assert.equal(db.prepare('SELECT count(*) AS n FROM billing_audit').get().n,1);
  const checkout = response(); await routes.get('post:/api/billing/checkout')({ admin: { role: 'admin', project_id: 'other' }, body: { plan: 'growth' } }, checkout);
  assert.equal(checkout.code,200); assert.match(checkout.body.url,/sandbox.whop.com/);
  const sent = JSON.parse(calls.at(-1).options.body); assert.equal(sent.variant_id,'plan_growth');
  assert.equal(db.prepare('SELECT project_id FROM billing_orders WHERE id = ?').get(sent.metadata.support_order_id).project_id,'other');
});

test('live checkout stays disabled until a public application URL is configured', async t => {
  const db = new Database(':memory:');
  const routes = new Map();
  const app = Object.fromEntries(['get','post','patch'].map(method => [method, (url, ...handlers) => routes.set(method + ':' + url, handlers.at(-1))]));
  const billing = registerBilling({ app, db, requireAdmin: () => {}, isOwner: () => true, now: () => new Date().toISOString(), env: { WHOP_ENVIRONMENT: 'production', WHOP_API_KEY: 'test', WHOP_ACCOUNT_ID: 'biz_test', WHOP_WEBHOOK_SECRET: 'test', WHOP_STARTER_PLAN_ID: 'plan_test', APP_URL: 'http://localhost:5173' }, fetchApi: async () => { throw new Error('Whop must not be called'); } });
  t.after(() => { billing.stop(); db.close(); });
  const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.body = data; } };
  routes.get('get:/api/billing/options')({}, response);
  assert.equal(response.body.plans.starter, false);
  await routes.get('post:/api/billing/checkout')({ admin: { role: 'admin', project_id: 'test' }, body: { plan: 'starter' } }, response);
  assert.equal(response.code, 503);
});
