'use client';
import { useState } from 'react';
import { browserClient } from '@/lib/browser';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await browserClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) {
      setError('That email and password did not match. Try again.');
      return;
    }
    window.location.assign('/register');
  }

  return (
    <>
      <header className="bar">
        <div className="brand">Smoke<span>Pay</span></div>
      </header>
      <main className="narrow">
        <div className="card">
          <h1>Staff sign in</h1>
          <p className="muted small">Use the account your store manager set up for you.</p>
          <form onSubmit={signIn}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" required
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <div className="notice bad" role="alert">{error}</div>}
            <button className="wide" type="submit" disabled={busy}>
              {busy ? 'Signing in' : 'Sign in'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
