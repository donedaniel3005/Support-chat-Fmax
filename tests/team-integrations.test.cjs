const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createTeamAi } = require('../server/team-ai');
const { createTeamWebhooks, publicV4, validateUrl } = require('../server/team-webhooks');
function harness() {
  const routes = new Map();
  const app = Object.fromEntries(['get','put','post','delete'].map(method => [method, (path, ...handlers) => routes.set(`${method}:${path}`, handlers.at(-1))]));
  const response = () => ({ code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } });
  return { routes, app, response };
}
test('team AI encrypts keys, isolates workspace credentials, disables by default and surfaces provider failures', async () => {
  const db = new Database(':memory:'); const h = harness(); const calls = [];
  let failure = false;
  const ai = createTeamAi({ app: h.app, db, requireAdmin() {}, requireWorkspaceAdmin() {}, env: { INTEGRATION_ENCRYPTION_KEY: 'ab'.repeat(32), OPENAI_API_KEY: 'never-use-global' }, fetchApi: async (url, options) => { calls.push({ url, options }); return { ok: !failure, json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'A draft' }] }] }) }; } });
  const req = { admin: { project_id: 'acme' }, body: { provider: 'openai', model: 'team-model', apiKey: 'team-secret-key' } };
  let res = h.response(); h.routes.get('put:/api/projects/current/ai')(req, res);
  assert.equal(res.body.enabled, false); assert.equal(JSON.stringify(res.body).includes('team-secret-key'), false);
  assert.equal(db.prepare('SELECT encrypted_key FROM team_ai').get().encrypted_key.includes('team-secret-key'), false);
  await assert.rejects(ai.draft('acme', { messages: [] }), /Connect and enable/);
  req.body = { provider: 'openai', model: 'team-model', enabled: true }; h.routes.get('put:/api/projects/current/ai')(req, h.response());
  assert.equal((await ai.draft('acme', { messages: [{ body: 'Help', sender_type: 'user' }] })).draft, 'A draft');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer team-secret-key');
  assert.equal(JSON.parse(calls[0].options.body).store, false);
  await assert.rejects(ai.draft('other', { messages: [] }), /Connect and enable/);
  failure = true; await assert.rejects(ai.draft('acme', { messages: [] }), /provider could not/);
  h.routes.get('delete:/api/projects/current/ai')(req, h.response()); assert.equal(ai.settings('acme').configured, false);
  db.close();
});
test('webhooks sign durable tenant-scoped events, retry failures and reject private addresses', async () => {
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','100.100.100.200','172.16.0.1','::1']) assert.equal(publicV4(ip), false);
  assert.equal(publicV4('8.8.8.8'), true);
  assert.throws(() => validateUrl('http://example.com')); assert.throws(() => validateUrl('https://localhost')); assert.throws(() => validateUrl('https://user:pass@example.com'));
  const db = new Database(':memory:'); const h = harness(); const sent = []; let ok = false;
  const hooks = createTeamWebhooks({ env: { INTEGRATION_ENCRYPTION_KEY: 'ab'.repeat(32) }, app: h.app, db, requireAdmin() {}, requireWorkspaceAdmin() {}, send: async (...args) => { sent.push(args); return ok; } });
  const res = h.response(); h.routes.get('post:/api/projects/current/webhooks')({ admin: { project_id: 'acme' }, body: { url: 'https://receiver.example/events', events: ['message.created'] } }, res);
  assert.equal(res.code, 201); assert.equal(res.body.webhooks[0].secret, undefined);
  hooks.enqueue('other', 'message.created', { body: 'private' }); hooks.enqueue('acme', 'message.created', { body: 'help' });
  await hooks.processQueue(); assert.equal(sent.length, 1);
  const [url, body, headers] = sent[0];
  const signature = require('node:crypto').createHmac('sha256', res.body.secret).update(`${headers['X-Support-Timestamp']}.${body}`).digest('hex');
  assert.equal(headers['X-Support-Signature'], `v1=${signature}`);
  assert.equal(db.prepare('SELECT state FROM team_webhook_deliveries').get().state, 'pending');
  db.prepare('UPDATE team_webhook_deliveries SET next_at=0').run(); ok = true; await hooks.processQueue();
  assert.equal(db.prepare('SELECT state FROM team_webhook_deliveries').get().state, 'delivered');
  hooks.stop(); db.close();
});
