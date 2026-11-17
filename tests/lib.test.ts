import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { formatCents, parseDollarsToCents } from '@/lib/money';
import { normalizeUsPhone } from '@/lib/phone';
import { resolveProvider } from '@/lib/providers';
import type { PaymentProvider } from '@/lib/providers/types';
import { verifyHmacSha256Hex } from '@/lib/signature';
import { hashToken, looksLikeToken, newLinkToken } from '@/lib/tokens';

describe('money', () => {
  it('parses dollars to exact cents', () => {
    expect(parseDollarsToCents('48')).toBe(4800);
    expect(parseDollarsToCents('48.5')).toBe(4850);
    expect(parseDollarsToCents('$1,234.56')).toBe(123456);
    expect(parseDollarsToCents('0.07')).toBe(7);
    expect(parseDollarsToCents('19.99')).toBe(1999);
  });
  it('rejects bad amounts', () => {
    for (const bad of ['', '0', '-5', '4.999', 'abc', '5000.01', '1e3']) {
      expect(parseDollarsToCents(bad)).toBeNull();
    }
  });
  it('formats cents', () => {
    expect(formatCents(4800)).toBe('$48.00');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(7)).toBe('$0.07');
  });
});

describe('link tokens', () => {
  it('are long, unique and hash consistently', () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a).not.toBe(b);
    expect(looksLikeToken(a)).toBe(true);
    expect(looksLikeToken('short')).toBe(false);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});

describe('phone numbers', () => {
  it('normalizes US numbers and rejects others', () => {
    expect(normalizeUsPhone('(585) 447-2393')).toBe('+15854472393');
    expect(normalizeUsPhone('1 585 447 2393')).toBe('+15854472393');
    expect(normalizeUsPhone('12345')).toBeNull();
    expect(normalizeUsPhone('155-555-0148')).toBeNull();
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const good = createHmac('sha256', secret).update(body).digest('hex');
  it('accepts the right signature only', () => {
    expect(verifyHmacSha256Hex(body, secret, good)).toBe(true);
    expect(verifyHmacSha256Hex(body + ' ', secret, good)).toBe(false);
    expect(verifyHmacSha256Hex(body, 'other', good)).toBe(false);
    expect(verifyHmacSha256Hex(body, secret, '')).toBe(false);
    expect(verifyHmacSha256Hex(body, '', good)).toBe(false);
  });
});

describe('payment partner gate', () => {
  const partner = (mode: 'sandbox' | 'live', configured: boolean): PaymentProvider => ({
    id: 'p',
    rail: 'pay_by_bank',
    mode: () => mode,
    isConfigured: () => configured,
    createCheckout: async () => ({ providerRef: 'r', redirectUrl: 'https://example.com' }),
    parseWebhook: async () => [],
    refund: async () => ({ providerRef: 'r', status: 'succeeded' }),
  });
  it('stays closed unless a configured partner matches the store', () => {
    expect(resolveProvider({ provider: null, live: true })).toEqual({ ok: false, reason: 'no_partner' });
    expect(resolveProvider({ provider: 'p', live: true })).toEqual({ ok: false, reason: 'no_partner' });
    expect(resolveProvider({ provider: 'p', live: true }, { p: partner('live', false) }))
      .toEqual({ ok: false, reason: 'partner_not_configured' });
    expect(resolveProvider({ provider: 'p', live: false }, { p: partner('live', true) }))
      .toEqual({ ok: false, reason: 'store_not_live' });
    expect(resolveProvider({ provider: 'p', live: false }, { p: partner('sandbox', true) }).ok).toBe(true);
    expect(resolveProvider({ provider: 'p', live: true }, { p: partner('live', true) }).ok).toBe(true);
  });
});
