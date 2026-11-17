# SmokePay build status

Last updated: 2026-11-17

## Where the build stands

The foundation is built and tested. Customer checkout is closed until a payment partner is connected. Nothing in this code pretends to move money.

| Piece | State |
| --- | --- |
| Database schema, money rules, row-level security | Built, 14 database tests passing |
| Staff sign in | Built (Supabase email and password) |
| Register screen: create link, QR code, text link, live status, cancel, refund | Built |
| Customer pay page | Built, hands off to the partner's secure page |
| Partner webhook intake with signature check and repeat protection | Built |
| Payment partner adapter | Not built. Needs a signed partner and sandbox credentials |
| Supabase project | Not created |
| Vercel deployment | Not connected |
| POS and Metrc reconciliation feed | Not started |

## What Ken needs to do next

1. Merge the pull request for branch `claude/smokepay-foundation` into `main`.
2. Supabase: create a project named `smokepay` (or name an existing one). Run `supabase/migrations/0001_smokepay_core.sql` in the SQL editor.
3. Vercel: import `KCLARKRANGER/Smokepay` and add these environment variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_BASE_URL` (the Vercel address, for example `https://smokepay.vercel.app`)
   - `CRON_SECRET` (any long random string)
   - Optional for texting: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
4. Supabase Authentication: add a user for yourself (email and password). Then run the SQL in "First store" below.
5. Payment partner: obtain written approval and sandbox credentials. Send the API documentation link plus the key, secret, merchant ID and webhook signing secret.

## First store

Replace the email, then run in the Supabase SQL editor:

```sql
with s as (
  insert into stores (name) values ('Pilot Store') returning id
)
insert into store_members (store_id, user_id, role)
select s.id, u.id, 'owner' from s, auth.users u where u.email = 'you@example.com';
```

## How money is protected

- Amounts are whole cents. The limit per payment is $5,000.
- Only the server can change a payment. Staff accounts can read their own store and nothing else.
- A payment becomes Paid only when the partner sends a signed event whose amount matches exactly.
- A repeated partner event is ignored. Money reported for a canceled, expired or mismatched payment goes to review and is never applied automatically.
- Every payment and refund posts a balanced double entry. The journal and audit log cannot be edited or deleted.
- The customer link holds a random token. Only its hash is stored. Links expire after 15 minutes.
- SmokePay never sees or stores card or bank details, and never holds customer funds.

## What Flowhub's Mobile Pay demo shows (reviewed 2026-11-17)

- Cashier taps Mobile Pay, enters the customer's phone number, and texts a link. The register waits with a Cancel button.
- The text comes from a toll-free number with neutral wording and a link hosted on Flowhub's own address.
- The customer sees the store name, amount due and an Apple Pay button, and pays with a debit card in the wallet.
- The customer's confirmation reads "Funds loaded", not "Payment complete". That points to a stored-value design: the card loads money into an account for the customer and the store is paid from that account. This is an inference from the demo's wording.
- No processor or bank is named anywhere in the demo.

Impact on this build: the partner to find is a stored-value program that underwrites cannabis and holds the funds under its own license. When its event model is known, payment sessions get a "funds loaded" step before "paid", and refunds may return to the customer's balance instead of the card.

## Open items before a live sale

- Which partner and rail (Pay by Bank, stored-value wallet funded by card, or both), approved in writing.
- Cannabis payments counsel sign-off: merchant of record, fee disclosure, New York requirements.
- Text messaging registration. Carriers filter cannabis wording, so messages stay neutral.
- Pilot store, its POS, and its bank's approval of the partner.
