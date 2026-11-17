# SmokePay build status

Last updated: 2026-11-17, 6:10 pm

## Where the build stands

The app is built, tested and merged to `main`. The database is live. The app is not on Vercel yet: the Vercel project needs Ken to import the repo. Customer checkout stays closed until a payment partner is connected. Nothing in this code pretends to move money.

| Piece | State |
| --- | --- |
| Database schema, money rules, row-level security | Built, merged |
| Staff sign in, register screen (link, QR, text, live status, cancel, refund) | Built, merged |
| Staff access: owners and managers add staff by email | Built |
| Customer pay page, signed partner webhook intake | Built, merged |
| Health check at `/api/health` (shows which settings are present, never their values) | Built |
| Checks | 25 tests passing, type check clean, production build clean |
| Supabase project `smokepay` (ref `yfzomvtthwmjzohymsio`, US East) | Live. Migrations 0001 to 0003 applied. Security advisor: one intentional note (partner events are server-only) |
| Test store and owner invite | Created: `SmokePay Test Store`, owner invite for `clark@smokealarm.io` waiting for that login |
| Vercel project | Not created: Claude's Vercel connection is refused project creation |
| Payment partner adapter | Not built: needs a signed partner and sandbox credentials |
| POS and Metrc reconciliation feed | Not started |

## What Ken needs to do next

1. **Import the repo into Vercel.** In Vercel, open the team that holds `auditshield`. Choose Add New, then Project, and import `KCLARKRANGER/Smokepay`. If the repo is not listed, adjust the Vercel GitHub app so it can see that repo. Deploy with the default settings. Claude's Vercel connection is refused project creation, so this step is yours.
2. **Connect the database.** In the new `smokepay` Vercel project, open the Storage tab and connect the existing Supabase database `smokepay`. This writes the Supabase address and keys, including the server key, into the project. If it is not offered there, open Supabase, then the `smokepay` project, Project Settings, API, copy the `service_role` key, and add it in Vercel as `SUPABASE_SERVICE_ROLE_KEY` marked Sensitive.
3. **Tell Claude.** Claude adds `APP_BASE_URL` and `CRON_SECRET` (or gives you the values to paste if Vercel refuses), redeploys, and checks `/api/health`.
4. **Create your login.** In Supabase, open Authentication, then Users, choose Add user, then Create new user. Use `clark@smokealarm.io`, set your own password, and tick Auto Confirm. You become owner of the test store automatically.

## Settings the app reads

| Setting | Required | Set by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) | Yes | Supabase connection, or Claude |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | Yes | Supabase connection, or Claude |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | Yes, keep secret | Supabase connection, or Ken |
| `APP_BASE_URL` | Yes | Claude |
| `CRON_SECRET` | Yes | Claude |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Only for texting links | Ken, once a Twilio account exists |

## First store (already run on 2026-11-17)

```sql
with s as (
  insert into stores (name) values ('SmokePay Test Store') returning id
)
select sp_invite(s.id, null, 'clark@smokealarm.io', 'owner') from s;
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
