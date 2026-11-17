export type SessionStatus =
  | 'open' | 'processing' | 'paid' | 'failed' | 'canceled' | 'expired'
  | 'partially_refunded' | 'refunded';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  open: 'Waiting for customer',
  processing: 'Customer is paying',
  paid: 'Paid',
  failed: 'Payment failed',
  canceled: 'Canceled',
  expired: 'Expired',
  partially_refunded: 'Partly refunded',
  refunded: 'Refunded',
};

export function statusTone(s: SessionStatus): '' | 'wait' | 'warn' | 'bad' {
  if (s === 'open' || s === 'processing') return 'wait';
  if (s === 'paid') return '';
  if (s === 'failed') return 'bad';
  return 'warn';
}
