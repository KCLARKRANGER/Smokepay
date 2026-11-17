import { NextResponse } from 'next/server';
import { env } from './env';

export function fail(status: number, error: string, detail?: string) {
  return NextResponse.json({ error, detail }, { status });
}

export function ok<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Public address used in customer links. APP_BASE_URL wins when set. */
export function baseUrl(req: Request): string {
  const fixed = env('APP_BASE_URL');
  if (fixed) return fixed.replace(/\/+$/, '');
  // Vercel sets this automatically to the project's production address.
  const vercelProd = env('VERCEL_PROJECT_PRODUCTION_URL');
  if (vercelProd && env('VERCEL_ENV') === 'production') return `https://${vercelProd}`;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

const KNOWN = [
  'not_a_member', 'not_allowed', 'session_not_found', 'session_not_open', 'session_expired',
  'session_not_cancelable', 'session_not_refundable', 'refund_exceeds_payment', 'invalid_ttl',
  'invalid_email',
] as const;

/** Maps a database function error to a stable code and HTTP status. */
export function dbFail(message: string | undefined) {
  const code = KNOWN.find((k) => message?.includes(k));
  if (!code) return fail(500, 'server_error');
  const status = code === 'not_a_member' || code === 'not_allowed' ? 403
    : code === 'session_not_found' ? 404 : 409;
  return fail(status, code);
}

export const SESSION_COLUMNS =
  'id, store_id, order_ref, amount_cents, status, customer_phone_last4, provider, expires_at, paid_at, created_at';
