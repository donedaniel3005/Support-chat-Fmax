function publicApplicationUrl(env = process.env) {
  const value = env.APP_URL || env.RENDER_EXTERNAL_URL || env.CLIENT_URL || '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '[::1]' || host === '[::]' || /^\[(?:fc|fd|fe80)/i.test(host)) return null;
    if (/^(127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return url.origin;
  } catch { return null; }
}
function launchChecks(env = process.env) {
  const checks = [
    { name: 'Public HTTPS application URL', ready: Boolean(publicApplicationUrl(env)) },
    { name: 'Production runtime', ready: env.NODE_ENV === 'production' },
    { name: 'Real administrator email', ready: Boolean(env.ADMIN_EMAIL && env.ADMIN_EMAIL !== 'admin@example.com') },
    { name: 'Strong administrator password', ready: Boolean(env.ADMIN_PASSWORD?.length >= 14 && !['admin12345','change-this-before-deploying'].includes(env.ADMIN_PASSWORD)) },
    { name: 'Configured owner email', ready: Boolean(env.OWNER_EMAIL) },
    { name: 'Persistent database path', ready: Boolean(env.DATABASE_PATH && env.DATABASE_PATH !== './support.sqlite') },
    { name: 'Encrypted team integration storage', ready: /^[a-f0-9]{64}$/i.test(env.INTEGRATION_ENCRYPTION_KEY || '') },
    { name: 'Password-recovery mail', ready: ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM'].every(key => Boolean(env[key])) },
    { name: 'Whop production environment', ready: env.WHOP_ENVIRONMENT === 'production' },
    { name: 'Whop account and credentials', ready: ['WHOP_API_KEY','WHOP_ACCOUNT_ID','WHOP_WEBHOOK_SECRET'].every(key => Boolean(env[key])) },
    { name: 'Whop plan mappings', ready: ['WHOP_STARTER_PLAN_ID','WHOP_GROWTH_PLAN_ID','WHOP_PARTNER_PLAN_ID'].every(key => /^plan_/.test(env[key] || '')) }
  ];
  return { checks, ready: checks.every(check => check.ready), publicUrl: publicApplicationUrl(env) };
}
module.exports = { publicApplicationUrl, launchChecks };
