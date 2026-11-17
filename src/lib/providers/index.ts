import type { PaymentProvider } from './types';

/**
 * Registered payment partners, keyed by the id stored on stores.provider.
 *
 * This is empty on purpose. An adapter is added here only after a partner has
 * approved SmokePay in writing and issued credentials. Until then customer
 * checkout stays closed: there is no built-in test partner that pretends to
 * move money.
 */
const registry: Record<string, PaymentProvider> = {};

export type ProviderLookup =
  | { ok: true; provider: PaymentProvider }
  | { ok: false; reason: 'no_partner' | 'partner_not_configured' | 'store_not_live' };

export function resolveProvider(
  store: { provider: string | null; live: boolean },
  providers: Record<string, PaymentProvider> = registry,
): ProviderLookup {
  if (!store.provider) return { ok: false, reason: 'no_partner' };
  const provider = providers[store.provider];
  if (!provider) return { ok: false, reason: 'no_partner' };
  if (!provider.isConfigured()) return { ok: false, reason: 'partner_not_configured' };
  if (provider.mode() === 'live' && !store.live) return { ok: false, reason: 'store_not_live' };
  return { ok: true, provider };
}

export function getProviderById(id: string): PaymentProvider | null {
  return registry[id] ?? null;
}
