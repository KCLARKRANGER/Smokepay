'use client';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserClient } from '@/lib/browser';
import { formatCents, parseDollarsToCents } from '@/lib/money';
import { STATUS_LABEL, statusTone, type SessionStatus } from '@/lib/status';

type Store = {
  id: string;
  name: string;
  role: 'owner' | 'manager' | 'cashier';
  live: boolean;
  checkout: 'ready' | 'no_partner' | 'partner_not_configured' | 'store_not_live';
};
type Me = { email: string; textingReady: boolean; stores: Store[] };
type Session = {
  id: string;
  order_ref: string;
  amount_cents: number;
  status: SessionStatus;
  customer_phone_last4: string | null;
  created_at: string;
};
type Invite = { email: string; role: string; created_at: string; accepted_at: string | null };
type Active = { session: Session; payUrl: string | null; qr: string | null; sms: string };

const CHECKOUT_NOTE: Record<Exclude<Store['checkout'], 'ready'>, string> = {
  no_partner:
    'No payment partner is connected to this store yet. You can create links, but customers cannot pay until a partner is connected.',
  partner_not_configured:
    'The payment partner for this store is missing its credentials. Customers cannot pay until that is fixed.',
  store_not_live:
    'This store has not been switched live. Customers cannot pay with real money yet.',
};

const SMS_NOTE: Record<string, string> = {
  sent: 'Link sent by text.',
  failed: 'The text did not send. Have the customer scan the code.',
  not_configured: 'Texting is not set up. Have the customer scan the code.',
  not_requested: 'Have the customer scan the code.',
};

export default function RegisterPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [storeId, setStoreId] = useState('');
  const [orderRef, setOrderRef] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState<Active | null>(null);
  const [recent, setRecent] = useState<Session[]>([]);
  const [refundFor, setRefundFor] = useState<Session | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundNote, setRefundNote] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'manager' | 'cashier'>('cashier');
  const [inviteNote, setInviteNote] = useState('');
  const createKey = useRef<string | null>(null);
  const refundKey = useRef<string | null>(null);

  const store = me?.stores.find((s) => s.id === storeId) ?? null;

  const loadRecent = useCallback(async (id: string) => {
    const res = await fetch(`/api/sessions?storeId=${id}`, { cache: 'no-store' });
    if (res.ok) setRecent((await res.json()).sessions);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (res.status === 401) {
        window.location.assign('/login');
        return;
      }
      if (!res.ok) {
        setError('SmokePay could not load your account. Refresh to try again.');
        return;
      }
      const data: Me = await res.json();
      setMe(data);
      if (data.stores[0]) setStoreId(data.stores[0].id);
    })();
  }, []);

  const loadInvites = useCallback(async (id: string) => {
    const res = await fetch(`/api/stores/${id}/invites`, { cache: 'no-store' });
    if (res.ok) setInvites((await res.json()).invites);
  }, []);

  useEffect(() => {
    if (storeId) loadRecent(storeId);
  }, [storeId, loadRecent]);

  const isManager = store?.role === 'owner' || store?.role === 'manager';
  useEffect(() => {
    if (storeId && isManager) loadInvites(storeId);
  }, [storeId, isManager, loadInvites]);

  // Watch the active payment until it finishes.
  const activeId = active?.session.id;
  const activeStatus = active?.session.status;
  useEffect(() => {
    if (!activeId || (activeStatus !== 'open' && activeStatus !== 'processing')) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/sessions/${activeId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { session } = await res.json();
      setActive((a) => (a && a.session.id === session.id ? { ...a, session } : a));
      if (session.status !== 'open' && session.status !== 'processing' && storeId) loadRecent(storeId);
    }, 3000);
    return () => clearInterval(timer);
  }, [activeId, activeStatus, storeId, loadRecent]);

  async function createLink(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const cents = parseDollarsToCents(amount);
    if (!cents) {
      setError('Enter the amount due, for example 48.00. The limit is $5,000.');
      return;
    }
    if (!createKey.current) createKey.current = crypto.randomUUID();
    setBusy(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          orderRef,
          amountCents: cents,
          phone: phone.trim() || undefined,
          idempotencyKey: createKey.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === 'invalid_phone'
            ? 'That phone number does not look right. Use a 10 digit US number.'
            : 'The link was not created. Check the order number and amount, then try again.',
        );
        return;
      }
      createKey.current = null;
      const qr = data.payUrl ? await QRCode.toDataURL(data.payUrl, { margin: 1, width: 440 }) : null;
      setActive({ session: data.session, payUrl: data.payUrl, qr, sms: data.sms });
      setOrderRef('');
      setAmount('');
      setPhone('');
      loadRecent(storeId);
    } catch {
      setError('No connection. Your link was not created twice: press the button again.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelActive() {
    if (!active) return;
    const res = await fetch(`/api/sessions/${active.session.id}/cancel`, { method: 'POST' });
    if (res.ok) {
      setActive({ ...active, session: { ...active.session, status: 'canceled' } });
      loadRecent(storeId);
    } else {
      setError('This payment can no longer be canceled. Check its status below.');
    }
  }

  async function submitRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundFor) return;
    const cents = parseDollarsToCents(refundAmount);
    if (!cents) {
      setRefundNote('Enter the refund amount, for example 12.00.');
      return;
    }
    if (!refundKey.current) refundKey.current = crypto.randomUUID();
    const res = await fetch(`/api/sessions/${refundFor.id}/refunds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: cents, reason: refundReason, idempotencyKey: refundKey.current }),
    });
    const data = await res.json();
    if (!res.ok) {
      setRefundNote(
        data.error === 'refund_exceeds_payment'
          ? 'That is more than what is left to refund on this payment.'
          : data.error === 'not_allowed'
            ? 'Only an owner or manager can refund.'
            : 'The refund was not started. Try again.',
      );
      return;
    }
    refundKey.current = null;
    const status = data.refund?.status;
    setRefundNote(
      status === 'succeeded' ? 'Refund sent.'
        : status === 'failed' ? 'The payment partner did not accept the refund.'
          : 'Refund is waiting on the payment partner.',
    );
    loadRecent(storeId);
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteNote('');
    const res = await fetch(`/api/stores/${storeId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    if (!res.ok) {
      setInviteNote(res.status === 403 ? 'Only an owner or manager can add staff.' : 'Check the email address and try again.');
      return;
    }
    const { invite } = await res.json();
    setInviteNote(
      invite.accepted_at
        ? `${invite.email} already had an account and now has access.`
        : `${invite.email} gets access as soon as their account is created with that email.`,
    );
    setInviteEmail('');
    loadInvites(storeId);
  }

  async function signOut() {
    await browserClient().auth.signOut();
    window.location.assign('/login');
  }

  const canRefund = isManager;
  const waiting = active && (active.session.status === 'open' || active.session.status === 'processing');

  return (
    <>
      <header className="bar">
        <div className="brand">Smoke<span>Pay</span></div>
        <button type="button" onClick={signOut}>Sign out</button>
      </header>
      <main>
        {!me && !error && <p className="muted">Loading</p>}
        {error && <div className="notice bad" role="alert">{error}</div>}
        {me && me.stores.length === 0 && (
          <div className="notice warn">
            Your account ({me.email}) is not linked to a store yet. Ask the store owner to add you.
          </div>
        )}
        {me && store && (
          <>
            {me.stores.length > 1 && (
              <div className="field">
                <label htmlFor="store">Store</label>
                <select id="store" value={storeId} onChange={(e) => { setStoreId(e.target.value); setActive(null); }}>
                  {me.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {store.checkout !== 'ready' && (
              <div className="notice warn" role="status">{CHECKOUT_NOTE[store.checkout]}</div>
            )}
            <div className="grid two">
              <section className="card" aria-labelledby="new-h">
                <h2 id="new-h">New mobile payment at {store.name}</h2>
                <form onSubmit={createLink}>
                  <div className="field">
                    <label htmlFor="order">Order number</label>
                    <input id="order" required maxLength={64} value={orderRef}
                      onChange={(e) => setOrderRef(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="amount">Total due</label>
                    <input id="amount" inputMode="decimal" placeholder="48.00" required value={amount}
                      onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Customer mobile number (optional)</label>
                    <input id="phone" type="tel" inputMode="tel" autoComplete="off" value={phone}
                      onChange={(e) => setPhone(e.target.value)} aria-describedby="phone-help" />
                    <p id="phone-help" className="muted small">
                      {me.textingReady
                        ? 'We text the link. Only the last 4 digits are kept.'
                        : 'Texting is not set up yet. Leave this blank and use the code.'}
                    </p>
                  </div>
                  <button className="wide" type="submit" disabled={busy}>
                    {busy ? 'Creating link' : 'Create payment link'}
                  </button>
                </form>
              </section>

              <section className="card" aria-labelledby="active-h" aria-live="polite">
                <h2 id="active-h">Current payment</h2>
                {!active && <p className="muted">Nothing in progress. Create a payment link to start.</p>}
                {active && (
                  <>
                    <p className="small muted">Order {active.session.order_ref}</p>
                    <div className="amount">{formatCents(active.session.amount_cents)}</div>
                    <p>
                      <span className={`pill ${statusTone(active.session.status)}`}>
                        {STATUS_LABEL[active.session.status]}
                      </span>
                    </p>
                    {active.session.status === 'paid' && (
                      <div className="notice good">Payment received. Release the order.</div>
                    )}
                    {waiting && active.qr && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="qr" src={active.qr} alt="Code the customer scans to pay" />
                        <p className="small center">{SMS_NOTE[active.sms] ?? SMS_NOTE.not_requested}</p>
                        <p className="small muted break">{active.payUrl}</p>
                      </>
                    )}
                    {waiting && (
                      <button type="button" className="quiet wide" onClick={cancelActive}>
                        Cancel payment
                      </button>
                    )}
                  </>
                )}
              </section>
            </div>

            <section className="card" style={{ marginTop: 16 }} aria-labelledby="recent-h">
              <h2 id="recent-h">Recent payments</h2>
              {recent.length === 0 ? (
                <p className="muted">No payments yet.</p>
              ) : (
                <div className="scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col" className="num">Amount</th>
                        <th scope="col">Status</th>
                        <th scope="col">Time</th>
                        {canRefund && <th scope="col"><span className="small">Refund</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((s) => (
                        <tr key={s.id}>
                          <td>{s.order_ref}</td>
                          <td className="num">{formatCents(s.amount_cents)}</td>
                          <td><span className={`pill ${statusTone(s.status)}`}>{STATUS_LABEL[s.status]}</span></td>
                          <td>{new Date(s.created_at).toLocaleString()}</td>
                          {canRefund && (
                            <td>
                              {(s.status === 'paid' || s.status === 'partially_refunded') && (
                                <button type="button" className="quiet" onClick={() => {
                                  setRefundFor(s);
                                  setRefundAmount((s.amount_cents / 100).toFixed(2));
                                  setRefundReason('');
                                  setRefundNote('');
                                  refundKey.current = null;
                                }}>
                                  Refund
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {refundFor && (
                <form onSubmit={submitRefund} style={{ marginTop: 16 }}>
                  <h2>Refund order {refundFor.order_ref}</h2>
                  <div className="field">
                    <label htmlFor="refund-amount">Refund amount</label>
                    <input id="refund-amount" inputMode="decimal" required value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="refund-reason">Reason</label>
                    <input id="refund-reason" required maxLength={200} value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)} />
                  </div>
                  {refundNote && <div className="notice warn" role="status">{refundNote}</div>}
                  <div className="row">
                    <button type="submit">Send refund</button>
                    <button type="button" className="quiet" onClick={() => setRefundFor(null)}>Close</button>
                  </div>
                </form>
              )}
            </section>

            {isManager && (
              <section className="card" style={{ marginTop: 16 }} aria-labelledby="staff-h">
                <h2 id="staff-h">Staff access</h2>
                <form onSubmit={submitInvite}>
                  <div className="grid two">
                    <div className="field">
                      <label htmlFor="invite-email">Staff email</label>
                      <input id="invite-email" type="email" required autoComplete="off" value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor="invite-role">Role</label>
                      <select id="invite-role" value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as 'manager' | 'cashier')}>
                        <option value="cashier">Cashier: takes payments</option>
                        <option value="manager">Manager: also refunds and adds staff</option>
                      </select>
                    </div>
                  </div>
                  {inviteNote && <div className="notice good" role="status">{inviteNote}</div>}
                  <button type="submit">Add staff</button>
                </form>
                {invites.length > 0 && (
                  <div className="scroll" style={{ marginTop: 16 }}>
                    <table>
                      <thead>
                        <tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Status</th></tr>
                      </thead>
                      <tbody>
                        {invites.map((i) => (
                          <tr key={i.email}>
                            <td className="break">{i.email}</td>
                            <td>{i.role}</td>
                            <td>
                              <span className={`pill ${i.accepted_at ? '' : 'wait'}`}>
                                {i.accepted_at ? 'Active' : 'Waiting for account'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
