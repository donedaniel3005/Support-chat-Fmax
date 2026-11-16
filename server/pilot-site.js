const fs = require('node:fs');
const path = require('node:path');
function createPilotSite({ directory, apiOrigin, widgetKey }) {
  const files = { '/': ['index.html','text/html; charset=utf-8'], '/styles.css': ['styles.css','text/css; charset=utf-8'], '/app.js': ['app.js','application/javascript; charset=utf-8'] };
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end('Method not allowed'); return; }
    let body, type;
    if (url.pathname === '/runtime.js') {
      body = 'window.PILOT_CONFIG = ' + JSON.stringify({ apiOrigin, widgetKey, inboxUrl: apiOrigin + '/admin' }) + ';'; type = 'application/javascript; charset=utf-8';
    } else if (files[url.pathname]) {
      const [name, mime] = files[url.pathname]; type = mime;
      try { body = fs.readFileSync(path.join(directory, name)); } catch { res.writeHead(503); res.end('Pilot assets are unavailable.'); return; }
    } else { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : body);
  };
}
module.exports = { createPilotSite };
