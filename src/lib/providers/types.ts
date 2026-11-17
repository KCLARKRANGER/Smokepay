export type ProviderEvent = {
  /** The partner's unique id for this event. Used to ignore repeats. */
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed';
  /** The partner's reference for the payment, as returned by createCheckout. */
  providerRef: string;
  amountCents: number;
  raw: unknown;
};

export type CheckoutInput = {
  sessionId: string;
  amountCents: number;
  orderRef: string;
  storeName: string;
  merchantRef: string | null;
  /** Where the partner sends the customer back to. */
  returnUrl: string;
};

export type RefundInput = {
  refundId: string;
  providerRef: string;
  amountCents: number;
};

/**
 * One payment partner (a licensed processor that underwrites cannabis).
 * SmokePay never touches card or bank details: the customer is handed to the
 * partner's hosted page, and the partner tells us the result by signed webhook.
 */
export interface PaymentProvider {
  id: string;
  rail: 'pay_by_bank' | 'card_wallet';
  /** 'live' adapters only run for stores that have been switched live. */
  mode(): 'sandbox' | 'live';
  /** True only when every credential the adapter needs is present. */
  isConfigured(): boolean;
  createCheckout(input: CheckoutInput): Promise<{ providerRef: string; redirectUrl: string }>;
  /** Must verify the signature and throw if it does not match. */
  parseWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent[]>;
  refund(input: RefundInput): Promise<{ providerRef: string; status: 'succeeded' | 'failed' | 'pending' }>;
}
