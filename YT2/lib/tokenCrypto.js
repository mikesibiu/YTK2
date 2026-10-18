const crypto = require('crypto');

// AES-256-GCM. Stored format: "v1.<iv>.<tag>.<ciphertext>" (all base64url).

function parseKey(keyString) {
  if (!keyString || typeof keyString !== 'string') {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  }
  const trimmed = keyString.trim();
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, 'hex');
  } else {
    key = Buffer.from(trimmed, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex chars). Try: openssl rand -base64 32');
  }
  return key;
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, ciphertext].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

function decrypt(payload, key) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognised encrypted token format');
  }
  const [, iv, tag, ciphertext] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p, 'base64url')));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // Throws if the key is wrong or the data was tampered with.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { parseKey, encrypt, decrypt };
