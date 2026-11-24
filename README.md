# Luxel CRM: lead management

Lead desk for **Luxel Decor & Flowers**. Every inquiry is captured (Wix Quote
Builder, Wix contact forms, manual entry, CSV import), scored, qualified,
assigned, followed up and tracked to a sent quote and a won/lost outcome (revenue itself lives in the
proposals tool). Every change is recorded in an
append-only audit trail.

Stack (matches StemLedger so the two can merge): Next.js 15 App Router + TypeScript,
Tailwind 4, Postgres (Supabase or Neon) with Drizzle + migrations, Supabase Auth,
Inngest jobs, Resend email, Vitest.

## Run it locally

```bash
pnpm install
cp .env.example .env.local && cp .env.example .env   # defaults point at local Postgres
```

Create the two Postgres roles and databases once (the app role must not be a superuser, so RLS applies):

```bash
sudo -u postgres psql -c "create role luxel_owner login password 'luxel_owner'; create role luxel_app login password 'luxel_app' nobypassrls; create database luxel owner luxel_owner; create database luxel_test owner luxel_owner;"
```

```bash
pnpm db:reset      # migrate + seed (org, Sameer + Mansi, default round-robin rule)
pnpm db:demo       # optional: ~140 realistic demo leads
pnpm dev           # http://localhost:3000 → pick Sameer or Mansi on the login page
pnpm test          # 136 unit + integration tests (rebuilds luxel_test each run)
```

Other scripts:

| Command | What it does |
|---|---|
| `pnpm intake:test [url]` | Posts sample Quote Builder + Contact payloads to the Wix webhook, twice each (second is a no-op) |
| `pnpm backfill:wix --api` / `--csv file.csv` | Imports historical Wix form submissions (`--dry-run` to preview) |
| `pnpm job digest` / `pnpm job nightly` | Runs the 8:00 digest or the nightly rescore + duplicate scan by hand |
| `pnpm inngest:dev` | Local Inngest dev server (set `INNGEST_DEV=1`) |
| `pnpm db:generate` / `pnpm db:migrate` | New migration from `src/db/schema.ts` / apply migrations |

## How it fits together

```
Wix Quote Builder (Velo fetch) ─┐
Wix contact forms (Automation) ─┼─► POST /api/intake/wix ─┐
Manual "New lead" form ─────────┤                         ├─► ingestLead(): idempotency → normalize → source →
CSV import ─────────────────────┘                         │   duplicates → createLead (score + qualify) → assign → first follow-up
                                                          ▼
                     updateLead(): the ONLY writer of `leads`: diff → validate status → save →
                     one lead_events row per change → rescore/requalify, all in one transaction
```

| Where | What |
|---|---|
| `src/db/schema.ts`, `drizzle/` | Schema + migrations. `0002_rls_audit.sql` holds the RLS policies, grants and the append-only trigger |
| `src/lib/config/defaults.ts` | Every tunable: scoring weights, thresholds, service area, business hours, UTM mapping. Owners override in Settings |
| `src/lib/scoring.ts`, `qualification.ts`, `source.ts`, `duplicates.ts`, `assignment.ts`, `status.ts` | Pure, unit-tested business rules |
| `src/server/leads/service.ts` | `createLead`, `updateLead`, activities, follow-ups |
| `src/server/leads/intake.ts` | The shared intake pipeline |
| `src/lib/lead-filters.ts` | One filter model: URL ⇄ filter ⇄ SQL (leads list, export, bulk actions, dashboard) |
| `src/lib/metrics.ts` | Every dashboard number defined once, as a filter → its SQL and its `/leads?…` link |
| `src/server/import/csv.ts`, `src/lib/csv-import.ts` | CSV mapping, presets (interim tracker), preview, commit, undo |
| `src/server/jobs.ts`, `src/inngest/` | Daily digest (08:00 Toronto), nightly rescore + duplicate scan |
| `docs/wix-integration.md` | Velo snippet, Automation setup, testing, backfill |

### Guarantees and how they're enforced

- **Audit trail can't be edited.** The app role has only SELECT/INSERT on `lead_events`, and a trigger rejects UPDATE/DELETE/TRUNCATE for everyone, including the table owner. A test checks both.
- **Single write path.** A test fails if anything other than `service.ts` issues `update(leads)`.
- **Record IDs** (`LX-000123`) come from a never-reset Postgres sequence. Leads are never deleted (merge → `duplicate_of_id`, undo import → `archived_at`), so IDs and links survive.
- **Permissions:** owner / manager / staff checked in one `authorize()` layer *and* in Postgres RLS (staff see only their own and unassigned leads). Every query runs in `withCtx()`, which sets the org/user/role for RLS.
- **Dashboard = list.** Card, chart and table links are generated from the same filter the number was counted with. `tests/integration/dashboard.test.ts` follows every link and asserts the count matches.
- **Idempotent intake:** `submission_id` (or a content fingerprint for Automations) is unique per org. Re-imports are no-ops via a per-row fingerprint.
- **Fair scoring:** `scoreLead()` takes only fit, budget, timing, intent, contactability and engagement fields; a test confirms the name has no effect.

## Deploying (Vercel + Supabase)

1. **Supabase:** create the project. In SQL, create `luxel_app` (`login password '…' nobypassrls`) and run `pnpm db:migrate` with `DATABASE_OWNER_URL` set to the Supabase owner connection string. Point `DATABASE_URL` at `luxel_app` through the pooler (transaction mode works: the app sets context per transaction). Then `pnpm db:seed`.
2. **Auth:** `AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Create Sameer's and Mansi's users in Supabase Auth with the seeded emails (`sameer@luxeldecor.com`, `mansi@luxeldecor.com`; change in Settings first if different). They're linked on first login.
3. **Email:** `EMAIL_DRIVER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` (verified domain).
4. **Jobs:** connect the Vercel project to Inngest (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`); it discovers `/api/inngest`.
5. **Wix:** set `WIX_INTAKE_SECRET`, then follow `docs/wix-integration.md`.

## Notes for merging into StemLedger

- Tenant column is `org_id` (the brief's name); StemLedger's CLAUDE.md uses `studio_id`. Rename in one migration when merging.
- Roles here are `owner | manager | staff`; StemLedger plans `owner | admin | member | viewer`. Map manager→admin, staff→member.
- `getSession()` / `authorize()` / `withCtx()` follow StemLedger's provider-agnostic auth plan.
- The record ID sequence is global; with multiple tenants, switch to a per-org counter.

## Decisions worth knowing

- **Merging never rewrites history.** Events stay on the merged record; the survivor's timeline reads them in place. Follow-ups (mutable) are moved.
- **Undo import archives, never deletes.** Undo is blocked once anyone has touched a lead from the batch (user/webhook activity after the import).
- **Imports don't auto-assign or auto-create follow-ups** (historical data). Open imported leads show up under "Awaiting follow-up: no follow-up set". Bulk-assign them from the list.
- **Business hours default to Mon–Fri 9–5 Toronto** for the "2 business hours" first follow-up. Change in Settings if Saturdays count.
- **Contact forms use a Wix Automation** (token in the URL), because Velo documents no Wix Forms backend event for Editor sites and Automations document no custom headers.
- **Lost stages from the interim tracker** map to `lost` with the furthest stage they reached (after quote → reached proposal), so the historical funnel is right: no consult → `no_response`, after consult / after quote → `other` with the detail kept.
