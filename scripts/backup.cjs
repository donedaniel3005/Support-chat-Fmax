require('dotenv').config();
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
async function backup() {
  const source = path.resolve(process.env.DATABASE_PATH || './support.sqlite');
  if (!fs.existsSync(source)) throw new Error('The configured support database does not exist.');
  const directory = path.resolve(process.env.BACKUP_DIRECTORY || './backups');
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'support-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { await db.backup(target); console.log('Backup saved: ' + target); }
  finally { db.close(); }
}
backup().catch(error => { console.error(error.message); process.exitCode = 1; });
