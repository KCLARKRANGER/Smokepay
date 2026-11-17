import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { dbFail, fail, ok } from '@/lib/http';
import { getProviderById } from '@/lib/providers';
import { serviceClient } from '@/lib/supabase';

const Body = z.object({
  amountCents: z.number().int().min(1),
  reason: z.string().trim().min(1).max(200),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getUser();
  if (!auth) return fail(401, 'not_signed_in');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, 'invalid_request');
  const { id } = await ctx.params;
  const svc = serviceClient();

  // The database checks the role (owner or manager) and the refundable amount.
  const { data: refund, error } = await svc.rpc('sp_request_refund', {
    p_session: id,
    p_actor: auth.user.id,
    p_amount_cents: parsed.data.amountCents,
    p_reason: parsed.data.reason,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error || !refund) return dbFail(error?.message);
  if (refund.status !== 'pending') return ok({ refund });

  const { data: session } = await svc
    .from('payment_sessions')
    .select('provider, provider_ref')
    .eq('id', id)
    .single();
  const provider = session?.provider ? getProviderById(session.provider) : null;

  let outcome: { providerRef: string | null; status: 'succeeded' | 'failed' | 'pending' };
  if (!provider || !provider.isConfigured() || !session?.provider_ref) {
    outcome = { providerRef: null, status: 'failed' };
  } else {
    try {
      outcome = await provider.refund({
        refundId: refund.id,
        providerRef: session.provider_ref,
        amountCents: refund.amount_cents,
      });
    } catch {
      // Unknown result at the partner. Leave pending so a person can check
      // before anything is retried.
      return ok({ refund, note: 'partner_result_unknown' }, 202);
    }
  }
  if (outcome.status === 'pending') return ok({ refund }, 202);

  const { data: settled, error: settleError } = await svc.rpc('sp_settle_refund', {
    p_refund: refund.id,
    p_succeeded: outcome.status === 'succeeded',
    p_provider_ref: outcome.providerRef,
  });
  if (settleError) return dbFail(settleError.message);
  return ok({ refund: settled });
}
