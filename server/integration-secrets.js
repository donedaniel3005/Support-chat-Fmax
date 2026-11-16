const crypto = require('node:crypto');
function secretStore(env = process.env) {
  const key = /^[a-f0-9]{64}$/i.test(env.INTEGRATION_ENCRYPTION_KEY || '') ? Buffer.from(env.INTEGRATION_ENCRYPTION_KEY, 'hex') : null;
  return {
    ready: Boolean(key),
    seal(value) {
      if (!key) throw new Error('Secure integration storage is unavailable.');
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
    },
    unseal(value) {
      if (!key) throw new Error('Secure integration storage is unavailable.');
      const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64'));
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    }
  };
}
module.exports = { secretStore };
