const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createPilotSite } = require('../server/pilot-site');
test('pilot serves its public assets and runtime identifiers without exposing local files or credentials', () => {
  const serve = createPilotSite({ directory: path.join(__dirname,'../pilot-site'), apiOrigin:'http://localhost:4100', widgetKey:'public-test-widget' });
  function request(url, method = 'GET') {
    const response = { headers:{}, code:200, setHeader(k,v) { this.headers[k]=v; }, writeHead(code, headers) { this.code=code; Object.assign(this.headers,headers); }, end(body) { this.body=body; } };
    serve({ url, method },response); return response;
  }
  assert.equal(request('/').code,200);
  assert.match(String(request('/').body),/Put it through its paces/);
  assert.match(String(request('/app.js').body),/checklist/);
  const runtime = request('/runtime.js');
  assert.match(runtime.body,/public-test-widget/);
  assert.doesNotMatch(runtime.body,/password|encryptionKey/);
  assert.equal(request('/.sandbox/access.json').code,404);
  assert.equal(request('/../.env').code,404);
  assert.equal(request('/','POST').code,405);
  assert.equal(request('/','HEAD').body,undefined);
});
