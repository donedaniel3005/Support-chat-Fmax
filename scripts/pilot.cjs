const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { createPilotSite } = require('../server/pilot-site');
const workspace = path.resolve(__dirname, '..');
const directory = path.join(workspace, '.sandbox');
const backendPort = Number(process.env.PILOT_API_PORT || 4100);
const sitePort = Number(process.env.PILOT_SITE_PORT || 4174);
const origin = `http://localhost:${backendPort}`;
let child, site, stopping = false;
function available(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is in use. Set PILOT_API_PORT and PILOT_SITE_PORT to unused ports.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function stop(code = 0) {
  if (stopping) return; stopping = true;
  if (child) child.kill();
  if (site) site.close();
  process.exitCode = code;
}
async function start() {
  if (![backendPort,sitePort].every(p => Number.isInteger(p) && p > 1024 && p < 65536) || backendPort === sitePort) throw new Error('Choose two different ports between 1025 and 65535.');
  await available(backendPort); await available(sitePort);
  fs.mkdirSync(directory, { recursive: true });
  const accessPath = path.join(directory, 'access.json');
  let access;
  if (fs.existsSync(accessPath)) access = JSON.parse(fs.readFileSync(accessPath, 'utf8'));
  else {
    access = { email: 'pilot@example.test', password: crypto.randomBytes(18).toString('base64url'), encryptionKey: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(accessPath, JSON.stringify(access, null, 2), { mode: 0o600 });
  }
  fs.writeFileSync(path.join(directory, 'LOGIN.txt'), `LOCAL PILOT ONLY\n\nStaff inbox: ${origin}/admin\nEmail: ${access.email}\nPassword: ${access.password}\n\nDo not reuse this password for production.\n`, { mode: 0o600 });
  const databasePath = path.join(directory, 'pilot.sqlite');
  child = spawn(process.execPath, ['server/index.js'], { cwd: workspace, stdio: ['ignore','pipe','pipe'], env: {
    ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(backendPort), DATABASE_PATH: databasePath,
    ADMIN_EMAIL: access.email, ADMIN_PASSWORD: access.password, OWNER_EMAIL: access.email,
    APP_URL: origin, CLIENT_URL: origin, CLIENT_URLS: origin, INTEGRATION_ENCRYPTION_KEY: access.encryptionKey,
    SMTP_HOST: '', SMTP_USER: '', SMTP_PASSWORD: '', MAIL_FROM: '', DISCORD_WEBHOOK_URL: '',
    WHOP_API_KEY: '', WHOP_ACCOUNT_ID: '', WHOP_WEBHOOK_SECRET: '', WHOP_ENVIRONMENT: 'sandbox',
    WHOP_STARTER_PLAN_ID: '', WHOP_GROWTH_PLAN_ID: '', WHOP_PARTNER_PLAN_ID: '', OPENAI_API_KEY: '',
    PUBLIC_SUPPORT_WIDGET_KEY: '', TRUST_PROXY_HOPS: ''
  } });
  let log = ''; child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => { if (!stopping) { console.error('Pilot backend stopped:', code, log); stop(1); } });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stopping) return;
    try { ready = (await fetch(origin + '/health', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error('Pilot backend did not become ready. ' + log);
  const db = new Database(databasePath);
  const user = db.prepare('SELECT project_id FROM staff_users WHERE email = ?').get(access.email);
  if (!user) { db.close(); throw new Error('Pilot account is missing. Existing sandbox files were preserved.'); }
  db.prepare("UPDATE projects SET name = 'Northline Pilot', plan = 'partner', billing_status = 'owner_approved' WHERE id = ?").run(user.project_id);
  const project = db.prepare('SELECT widget_key FROM projects WHERE id = ?').get(user.project_id); db.close();
  site = http.createServer(createPilotSite({ directory: path.join(workspace, 'pilot-site'), apiOrigin: origin, widgetKey: project.widget_key }));
  site.on('error', error => { console.error(error.message); stop(1); });
  site.listen(sitePort, '127.0.0.1', () => {
    console.log(`\nCustomer test website: http://localhost:${sitePort}`);
    console.log(`Staff inbox: ${origin}/admin`);
    console.log(`Pilot email: ${access.email}`);
    console.log('Pilot login details are saved privately in .sandbox/LOGIN.txt.');
    console.log('Isolated pilot database. No live billing, SMTP or personal AI keys. Ctrl+C stops both sites.\n');
  });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
start().catch(error => { console.error(error.message); stop(1); });
