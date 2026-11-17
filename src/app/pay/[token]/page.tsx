import { formatCents } from '@/lib/money';
import { resolveProvider } from '@/lib/providers';
import { serviceClient } from '@/lib/supabase';
import { hashToken, looksLikeToken } from '@/lib/tokens';
import PayButton from './pay-button';

export const dynamic = 'force-dynamic';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bar">
        <div className="brand">Smoke<span>Pay</span></div>
      </header>
      <main className="narrow">
        <div className="card center">{children}</div>
      </main>
    </>
  );
}

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = (
    <Shell>
      <h1>Link not found</h1>
      <p className="muted">This payment link is not valid. Ask the store for a new one.</p>
    </Shell>
  );
  if (!looksLikeToken(token)) return notFound;

  const svc = serviceClient();
  const { data: session } = await svc
    .from('payment_sessions')
    .select('store_id, order_ref, amount_cents, status, expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (!session) return notFound;
  const { data: store } = await svc
    .from('stores')
    .select('name, provider, live')
    .eq('id', session.store_id)
    .single();
  if (!store) return notFound;

  const expired = session.status === 'expired'
    || (session.status === 'open' && new Date(session.expires_at).getTime() <= Date.now());
  const head = (
    <>
      <p className="muted small">Pay {store.name}</p>
      <div className="amount">{formatCents(session.amount_cents)}</div>
      <p className="muted small">Order {session.order_ref}</p>
    </>
  );

  if (expired) {
    return (
      <Shell>
        {head}
        <div className="notice warn">This link has expired. Ask the store for a new one.</div>
      </Shell>
    );
  }

  if (session.status === 'open') {
    const lookup = resolveProvider(store);
    return (
      <Shell>
        {head}
        {lookup.ok ? (
          <PayButton token={token} label={`Pay ${formatCents(session.amount_cents)}`} />
        ) : (
          <div className="notice warn">
            Mobile payment is not available at this store yet. Please pay at the counter.
          </div>
        )}
      </Shell>
    );
  }

  const message: Record<string, { tone: string; text: string }> = {
    processing: { tone: 'warn', text: 'Your payment is being confirmed. This page updates when it is done.' },
    paid: { tone: 'good', text: 'Payment received. Thank you. Show this screen at the counter.' },
    failed: { tone: 'bad', text: 'The payment did not go through. You were not charged. Ask the store for a new link.' },
    canceled: { tone: 'warn', text: 'The store canceled this payment.' },
    partially_refunded: { tone: 'good', text: 'This payment was partly refunded.' },
    refunded: { tone: 'good', text: 'This payment was refunded.' },
  };
  const m = message[session.status] ?? { tone: 'warn', text: 'Ask the store about this payment.' };
  return (
    <Shell>
      {head}
      <div className={`notice ${m.tone}`} role="status">{m.text}</div>
      {session.status === 'processing' && <meta httpEquiv="refresh" content="5" />}
    </Shell>
  );
}
