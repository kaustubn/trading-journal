import crypto from 'crypto';

// Encrypts broker credentials at rest with AES-256-GCM.
// Key derives from the ENCRYPTION_KEY env var (any length → sha256 → 32 bytes).
// Tolerant by design: values without the enc prefix are treated as legacy plaintext
// and returned unchanged, so existing rows keep working and no migration is needed.

const RAW = process.env.ENCRYPTION_KEY || '';
const KEY = RAW ? crypto.createHash('sha256').update(RAW).digest() : null;
const PREFIX = 'enc:v1:';

export function encrypt(plain: string | null | undefined): string | null | undefined {
  if (plain == null || plain === '') return plain;
  if (!KEY) return plain; // no key configured (dev) → store as-is
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(value: string | null | undefined): string | null | undefined {
  if (value == null || value === '') return value;
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // legacy plaintext
  if (!KEY) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return value;
  }
}
