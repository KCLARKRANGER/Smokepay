import { baseUrl, dbFail, fail, ok } from '@/lib/http';
import { resolveProvider } from '@/lib/providers';
import { serviceClient } from '@/lib/supabase';
import { hashToken, looksLikeToken } from '@/lib/tokens';

/** The customer taps Pay. Hands them to the store's payment partner. */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!looksLikeToken(token)) return fail(404, 'session_not_found');
  const svc = serviceClient();

  const { data: session } = await svc
    .from('payment_sessions')
    .select('id, store_id, order_ref, amount_cents, status, expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!session) return fail(404, 'session_not_found');
  if (session.status !== 'open') return fail(409, 'session_not_open');
  if (new Date(session.expires_at).getTime() <= Date.now()) return fail(409, 'session_expired');

  const { data: store } = await svc
    .from('stores')
    .select('name, provider, provider_merchant_ref, live')
    .eq('id', session.store_id)
    .single();
  if (!store) return fail(404, 'session_not_found');

  const lookup = resolveProvider(store);
  if (!lookup.ok) return fail(503, lookup.reason);

  let checkout: { providerRef: string; redirectUrl: string };
  try {
    checkout = await lookup.provider.createCheckout({
      sessionId: session.id,
      amountCents: session.amount_cents,
      orderRef: session.order_ref,
      storeName: store.name,
      merchantRef: store.provider_merchant_ref,
      returnUrl: `${baseUrl(req)}/pay/${token}`,
    });
  } catch {
    return fail(502, 'partner_unavailable');
  }

  const { error } = await svc.rpc('sp_mark_processing', {
    p_session: session.id,
    p_provider: lookup.provider.id,
    p_provider_ref: checkout.providerRef,
  });
  if (error) return dbFail(error.message);
  return ok({ redirectUrl: checkout.redirectUrl });
}
