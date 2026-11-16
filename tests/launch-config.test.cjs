const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicApplicationUrl, launchChecks } = require('../server/launch-config');
test('production URLs reject local, private, credential-bearing and insecure destinations', () => {
  for (const value of ['http://example.com', 'https://localhost', 'https://sub.localhost', 'https://127.0.0.1', 'https://10.0.0.1', 'https://192.168.1.2', 'https://172.20.0.1', 'https://[::1]', 'https://user:password@example.com']) assert.equal(publicApplicationUrl({ APP_URL: value }), null, value);
  assert.equal(publicApplicationUrl({ RENDER_EXTERNAL_URL: 'https://support.example.com/path' }), 'https://support.example.com');
  assert.equal(publicApplicationUrl({ APP_URL: 'https://customers.example.com', RENDER_EXTERNAL_URL: 'https://other.example.com' }), 'https://customers.example.com');
  assert.equal(launchChecks({}).ready, false);
});
