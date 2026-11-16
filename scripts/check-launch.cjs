require('dotenv').config();
const { launchChecks } = require('../server/launch-config');
const result = launchChecks();
for (const check of result.checks) console.log((check.ready ? 'READY  ' : 'MISSING') + ' ' + check.name);
console.log('\nThis checks configuration presence only. Verify real email delivery, a sandbox purchase, webhook activation, and backup restore before launch.');
if (!result.ready) process.exitCode = 1;
