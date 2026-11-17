# SmokePay build status

Last updated: 2026-11-17, 6:20 pm

## Where the build stands

The app is built, tested and merged to `main`. The database is live. Ken imported the repo into Vercel (project `smokepay`, address https://smokepay-ken-clarks-projects.vercel.app). It needs one secret pasted and one protection setting changed before it works. Customer checkout stays closed until a payment partner is connected. Nothing in this code pretends to move money.

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
| Vercel project `smokepay` | Created by Ken, deploying from `main`. Claude's Vercel connection can read it but cannot change settings or add variables |
| Payment partner adapter | Not built: needs a signed partner and sandbox credentials |
| POS and Metrc reconciliation feed | Not started |

## What Ken needs to do next

1. **Paste the server key.** In Supabase, open the `smokepay` project, then Project Settings, then API Keys. Copy the `service_role` key (or a secret key starting `sb_secret_`). In Vercel, open the `smokepay` project, Settings, Environment Variables, and add `SUPABASE_SERVICE_ROLE_KEY` with that value, marked Sensitive, for Production and Preview.
2. **Make the production address public.** In Vercel, open `smokepay`, Settings, Deployment Protection. Change Vercel Authentication to Standard Protection, which keeps preview builds private and leaves the production address open. Customers and payment partners cannot reach the pay page or webhooks while Vercel's login wall is in front of it.
3. **Optional: `CRON_SECRET`.** Add it with any long random string so the nightly job can close expired links. Links still expire without it.
4. **Redeploy.** In Vercel, open Deployments and redeploy the latest production deployment so it picks up the new key.
5. **Create your login.** In Supabase, open Authentication, then Users, choose Add user, then Create new user. Use `clark@smokealarm.io`, set your own password, and tick Auto Confirm. You become owner of the test store automatically.
6. **Tell Claude.** Claude checks `/api/health`, confirms the database answers, and walks the register flow with you.

## Settings the app reads

| Setting | Required | Set by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) | No, built into the code (`src/lib/public-config.ts`) | Override only |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | No, the public key is built into the code | Override only |
| `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) | Yes, keep secret | Ken |
| `APP_BASE_URL` | No, falls back to Vercel's production address | Only for a custom domain later |
| `CRON_SECRET` | Optional | Ken |
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
