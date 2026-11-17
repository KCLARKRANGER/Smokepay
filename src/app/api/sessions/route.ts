import { z } from 'zod';
import { getRole, getUser } from '@/lib/auth';
import { baseUrl, dbFail, fail, ok, SESSION_COLUMNS } from '@/lib/http';
import { MAX_AMOUNT_CENTS } from '@/lib/money';
import { normalizeUsPhone } from '@/lib/phone';
import { sendPaymentLink, type SmsResult } from '@/lib/sms';
import { serviceClient } from '@/lib/supabase';
import { hashToken, newLinkToken } from '@/lib/tokens';

const SESSION_TTL_MINUTES = 15;

const CreateBody = z.object({
  storeId: z.uuid(),
  orderRef: z.string().trim().min(1).max(64),
  amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
  phone: z.string().trim().max(32).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function GET(req: Request) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const storeId = new URL(req.url).searchParams.get('storeId');
  if (!storeId || !z.uuid().safeParse(storeId).success) return fail(400, 'invalid_store');
  // Row-level security limits this to the signed-in person's own store.
  const { data, error } = await auth.supabase
    .from('payment_sessions')
    .select(SESSION_COLUMNS)
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) return fail(500, 'server_error');
  return ok({ sessions: data });
}

export async function POST(req: Request) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, 'invalid_request', parsed.error.issues[0]?.message);
  const body = parsed.data;

  if (!(await getRole(auth.supabase, auth.user.id, body.storeId))) return fail(403, 'not_a_member');

  let phone: string | null = null;
  if (body.phone) {
    phone = normalizeUsPhone(body.phone);
    if (!phone) return fail(400, 'invalid_phone');
  }

  const token = newLinkToken();
  const tokenHash = hashToken(token);
  const { data: session, error } = await serviceClient().rpc('sp_create_session', {
    p_store: body.storeId,
    p_actor: auth.user.id,
    p_order_ref: body.orderRef,
    p_amount_cents: body.amountCents,
    p_token_hash: tokenHash,
    p_phone_last4: phone ? phone.slice(-4) : null,
    p_ttl_minutes: SESSION_TTL_MINUTES,
    p_idempotency_key: body.idempotencyKey,
  });
  if (error || !session) return dbFail(error?.message);

  // A repeated request returns the first session. Its link token cannot be
  // recovered (only the hash is stored), so no link is returned for a replay.
  const replayed = session.token_hash !== tokenHash;
  const payUrl = replayed ? null : `${baseUrl(req)}/pay/${token}`;
  let sms: SmsResult | 'not_requested' = 'not_requested';
  if (phone && payUrl) sms = await sendPaymentLink(phone, payUrl);

  const { token_hash: _omit, idempotency_key: _omit2, ...safe } = session;
  return ok({ session: safe, payUrl, sms, replayed }, 201);
}
