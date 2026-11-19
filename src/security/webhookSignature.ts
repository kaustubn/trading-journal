import crypto from 'crypto';

/** HMAC-SHA256 of the raw request body, as "sha256=<hex>". */
export function signHmac(rawBody: Buffer | string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * True only when `header` is a valid HMAC-SHA256 of the exact raw body under `secret`.
 * Fails closed: no secret, no body or no/garbled signature = false. Constant-time compare.
 */
export function verifyHmac(rawBody: Buffer | string | undefined, header: string | string[] | undefined, secret: string | undefined): boolean {
  if (!secret || rawBody === undefined || rawBody === null) return false;
  const sig = Array.isArray(header) ? header[0] : header;
  if (!sig || typeof sig !== 'string') return false;
  const hex = sig.startsWith('sha256=') ? sig.slice(7) : sig;
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(hex, 'hex'));
}
