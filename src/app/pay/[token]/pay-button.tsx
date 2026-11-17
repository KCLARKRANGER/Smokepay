'use client';
import { useState } from 'react';

export default function PayButton({ token, label }: { token: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/pay/${token}/start`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.redirectUrl) {
        window.location.assign(data.redirectUrl);
        return;
      }
      setError(
        res.status === 503
          ? 'Mobile payment is not available at this store yet. Please pay at the counter.'
          : res.status === 409
            ? 'This link can no longer be used. Ask the store for a new one.'
            : 'Payment could not start. You were not charged. Try again.',
      );
    } catch {
      setError('No connection. You were not charged. Try again.');
    }
    setBusy(false);
  }

  return (
    <>
      {error && <div className="notice bad" role="alert">{error}</div>}
      <button type="button" className="wide big" onClick={start} disabled={busy}>
        {busy ? 'Opening secure payment' : label}
      </button>
      <p className="muted small" style={{ marginTop: 12 }}>
        You will finish on the payment partner&apos;s secure page. SmokePay never sees your card or bank details.
      </p>
    </>
  );
}
