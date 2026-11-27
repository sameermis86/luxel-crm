# Wave (accounting) sync

Read-only: Wave invoices are copied into `wave_invoices` on every scheduled sync (full re-read, so edits and
deletions in Wave show up) and matched to a Finance contract by the Goodshuffle project number on the invoice
(PO/SO number first, then title, subheading, memo; `findProject` in `src/lib/wave.ts`). Nothing is created or
changed in Wave.

Finance shows: invoiced in Wave for the year (by invoice date; drafts don't count), "Invoiced in Wave" per contract
(sum of its non-draft invoices, or *Not invoiced*), and Wave invoices without a known project number.
Paid amounts aren't shown (Finance is revenue only).

## Connecting
1. In Wave, open the developer portal (Settings → Integrations → Developer / developer.waveapps.com), create an
   application and generate a **Full Access Token** for your own business.
2. Vercel → luxel-crm → Settings → Environment Variables (Production): `WAVE_ACCESS_TOKEN` (Sensitive).
   If the Wave login has more than one business, also `WAVE_BUSINESS_ID` (the sync error lists the names).
3. Redeploy. The first sync runs within 15 minutes; `POST /api/cron/wix-sync?only=wave` runs just this step.

API: GraphQL `https://gql.waveapps.com/graphql/public`, `Authorization: Bearer <token>`.
To match invoices, put the Goodshuffle project number in the invoice's PO/SO number field in Wave.

## Accounts, balances and daily snapshots
Wave's public API can read accounts (with current balances), customers, vendors, products, sales taxes,
invoices and estimates, but **not transactions** (only `moneyTransactionCreate` exists) and no reports.
So every sync copies the chart of accounts into `wave_accounts` (type, subtype, balance) and keeps one row per
account per day in `wave_balance_snapshots` (Toronto date; the day's last sync wins). Finance → "Balances from
Wave" shows today's balance-sheet groups (Wave's internal TRANSFERS accounts hidden), the change since the
snapshots ~7 and ~30 days back, and the daily cash & bank trend. History starts the day snapshots began.
`?inspect=wave` on the cron endpoint lists what Wave's API exposes (names only).
