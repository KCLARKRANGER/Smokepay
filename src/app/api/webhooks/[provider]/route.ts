import { fail, ok } from '@/lib/http';
import { getProviderById } from '@/lib/providers';
import type { ProviderEvent } from '@/lib/providers/types';
import { serviceClient } from '@/lib/supabase';

/** Payment partners report results here. Every request must carry a valid signature. */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: providerId } = await ctx.params;
  const provider = getProviderById(providerId);
  if (!provider || !provider.isConfigured()) return fail(404, 'unknown_partner');

  const raw = await req.text();
  let events: ProviderEvent[];
  try {
    events = await provider.parseWebhook(raw, req.headers);
  } catch {
    return fail(401, 'invalid_signature');
  }

  const svc = serviceClient();
  const outcomes: string[] = [];
  for (const event of events) {
    const { data, error } = await svc.rpc('sp_apply_provider_event', {
      p_provider: provider.id,
      p_event_id: event.eventId,
      p_type: event.type,
      p_provider_ref: event.providerRef,
      p_amount_cents: event.amountCents,
      p_payload: event.raw ?? {},
    });
    // A database failure returns 500 so the partner retries the delivery.
    if (error) return fail(500, 'server_error');
    outcomes.push(String(data));
  }
  return ok({ received: events.length, outcomes });
}
