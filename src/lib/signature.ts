import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks a hex HMAC-SHA256 signature over the raw request body.
 * Partner adapters use this to prove a webhook really came from the partner.
 */
export function verifyHmacSha256Hex(rawBody: string, secret: string, signatureHex: string): boolean {
  if (!secret || !signatureHex || !/^[0-9a-fA-F]{64}$/.test(signatureHex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(signatureHex, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
