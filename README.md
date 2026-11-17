# SmokePay

Pay-by-link checkout for licensed dispensaries. The cashier creates a payment for an order, the customer opens a link (by text or QR code) and pays on the payment partner's secure page, and the register shows the result.

See [STATUS.md](STATUS.md) for the current build stage and setup steps.

## Stack

Next.js (App Router, TypeScript), Supabase (Postgres and Auth), deployed on Vercel.

## Run locally

```bash
cp .env.example .env.local   # fill in the Supabase values
npm install
npm run dev
```

## Checks

```bash
npm test          # database rules (in-process Postgres) and unit tests
npm run typecheck
npm run build
```

## Layout

- `supabase/migrations/` database schema and the functions that change money state
- `src/lib/providers/` payment partner adapter contract and registry
- `src/app/register/` staff register screen
- `src/app/pay/[token]/` customer pay page
- `src/app/api/` server routes

## Adding a payment partner

Implement `PaymentProvider` from `src/lib/providers/types.ts`, register it in `src/lib/providers/index.ts`, and set `stores.provider` to its id. Checkout stays closed for a store until its partner is registered and fully configured, and live adapters only run for stores with `live = true`.
