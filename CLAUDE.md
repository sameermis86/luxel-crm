# CLAUDE.md: Luxel CRM

Luxel Decor & Flowers (Vaughan, ON) operations app, organised by division: **Sales & CRM** (lead management), **Fulfillment & Ops** (`/ops`: event board, pull sheets, setup/teardown from signed Goodshuffle contracts; see docs/ops.md), **Floral orders** (next phase). Single tenant today, `org_id` on every table for multi-tenancy later. Built to merge into StemLedger (same stack and conventions). See README.md for setup and architecture.

## Rules (do not break)

- **All writes to `leads` go through `updateLead()` / `createLead()` in `src/server/leads/service.ts`.** A test enforces this.
- **`lead_events` is append-only.** Never add an UPDATE/DELETE path. Corrections are new events.
- **Never delete leads.** Merge sets `duplicate_of_id`; undo import sets `archived_at`.
- **Every DB call runs inside `withCtx(ctx, fn)`** so RLS context is set. Authorization goes through `authorize()` in `src/server/auth.ts`.
- **Every dashboard number is a `LeadFilter` defined in `src/lib/metrics.ts`.** Never compute a dashboard count with ad-hoc SQL that the leads list can't reproduce. Extend `lead-filters.ts` instead, and add the case to `tests/integration/dashboard.test.ts`.
- **No lead score and no qualification tag** (both removed). Don't reintroduce them; the "Unqualified" status remains as a manual status.
- **Dashboard definitions:** Total leads = Quote Builder + Contact form + Goodshuffle (+ Other: manual/no channel), by `capture_channel`. Total quotes = Goodshuffle stages quote sent + signed (Goodshuffle "Action needed" counts as signed) + lost (`leads.goodshuffle_status`); each is shown as a share of total quotes.
- **Dashboard "in range" numbers are cohort counts:** leads created in the range, by where they stand now. Never count by won_at/proposal_sent_at: synced statuses carry the sync date. The action queue (`nextActions` in `metrics.ts`) is today's work, not range-limited.
- Tunables live in `src/lib/config/defaults.ts` (overridable per org in Settings). No magic numbers in business logic.
- Zod on every boundary (server actions, webhook, import).
- Every schema change ships as a migration (`pnpm db:generate`, or `--custom` for SQL). Grant new tables/sequences to `luxel_app` and add RLS policies.
- **Ops data comes from Goodshuffle; the team's work is ours.** The Ops sync may update Goodshuffle-sourced fields and flag removed lines, but never overwrites ticks, notes, or items/tasks the team added.
- Dates: business days and "today" are America/Toronto. Use `src/lib/dates.ts`.

## Design system

StemLedger's "cold storage + cut stem": ink #1B2420, bloom #BC5468, stem #5F8568, sage #8AA890, paper #F4F2EC, card #FFFFFF, edge #DCD6CB, muted #7B786F; Georgia-class serif headings, system sans for data. Chart colors are in `src/lib/chart-colors.ts` (validated for color-vision deficiency; re-run the validator if you change them).

## After each change

`pnpm typecheck && pnpm test` (needs local Postgres; see README).
