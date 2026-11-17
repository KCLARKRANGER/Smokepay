import { env } from './env';

export type SmsResult = 'sent' | 'not_configured' | 'failed';

/**
 * Texts the payment link through Twilio. The wording is deliberately neutral:
 * mobile carriers filter cannabis-related messages.
 */
export async function sendPaymentLink(toE164: string, url: string): Promise<SmsResult> {
  const sid = env('TWILIO_ACCOUNT_SID');
  const token = env('TWILIO_AUTH_TOKEN');
  const from = env('TWILIO_FROM_NUMBER');
  if (!sid || !token || !from) return 'not_configured';
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: toE164,
        From: from,
        Body: `Your secure payment link: ${url} Reply STOP to opt out.`,
      }),
    });
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
