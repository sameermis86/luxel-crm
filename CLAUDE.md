# CLAUDE.md: Luxel CRM

Luxel Decor & Flowers (Vaughan, ON) operations app, organised by module: **Sales & CRM** (lead management), **Fulfillment & Ops** (`/ops`: event board, pull sheets, setup/teardown from signed Goodshuffle contracts; see docs/ops.md), **Finance** (`/finance`: revenue from Goodshuffle contract exports, plus Wave invoices synced read-only and matched to contracts by project number; see docs/wave.md), **Floral orders** (next phase), **Admin** (settings, team & access, audit log). Single tenant today, `org_id` on every table for multi-tenancy later. Built to merge into StemLedger (same stack and conventions). See README.md for setup and architecture.

## Rules (do not break)

- **All writes to `leads` go through `updateLead()` / `createLead()` in `src/server/leads/service.ts`.** A test enforces this.
- **`lead_events` is append-only.** Never add an UPDATE/DELETE path. Corrections are new events.
- **Never delete leads.** Merge sets `duplicate_of_id`; undo import sets `archived_at`.
- **Every DB call runs inside `withCtx(ctx, fn)`** so RLS context is set. Authorization goes through `authorize()` in `src/server/auth.ts`.
- **Every dashboard number is a `LeadFilter` defined in `src/lib/metrics.ts`.** Never compute a dashboard count with ad-hoc SQL that the leads list can't reproduce. Extend `lead-filters.ts` instead, and add the case to `tests/integration/dashboard.test.ts`.
- **Won comes from a signed Goodshuffle contract or a person, never from a booking or other inference.** Moving a lead out of Won (other than to Lost) is owners only (`isUndoWin` in `src/lib/status.ts`, enforced in `updateLead`).
- **Texts and reminder emails follow CASL and are only ever sent by a person clicking:** `smsEligibility` / `emailEligibility` (consent window from the inquiry, opt-outs final unless the client asks back in), `renderSms` (sender named, "Reply STOP") and `emailFooter` (sender, sign-off, unsubscribe link). No automatic sends. See docs/sms.md.
- **Everything is entitlement-based** (docs/access-and-security.md): every page declares its action in `withPage(fn, action)`, every server action calls `authorize()`, and every new table gets a module gate in RLS (`app.has_access(module, level)`). New modules go in `MODULES` (schema), `src/lib/access.ts` and `app.default_access`, with a test keeping both defaults equal. Security events go to `audit_log` (append-only) via `audit()`.
- **No lead score and no qualification tag** (both removed). Don't reintroduce them; the "Unqualified" status remains as a manual status.
- **Dashboard definitions:** Total leads = Quote Builder + Contact form + Goodshuffle (+ Other: manual/no channel), by `capture_channel`. Total quotes = Goodshuffle stages quote sent + signed (Goodshuffle "Action needed" counts as signed) + lost (`leads.goodshuffle_status`); each is shown as a share of total quotes.
- **Dashboard "in range" numbers are cohort counts:** leads created in the range, by where they stand now. Never count by won_at/proposal_sent_at: synced statuses carry the sync date. The action queue (`nextActions` in `metrics.ts`) is today's work, not range-limited.
- Tunables live in `src/lib/config/defaults.ts` (overridable per org in Settings). No magic numbers in business logic.
- Zod on every boundary (server actions, webhook, import).
- Every schema change ships as a migration (`pnpm db:generate`, or `--custom` for SQL). Grant new tables/sequences to `luxel_app` and add RLS policies.
- **Ops data comes from Goodshuffle; the team's work is ours.** The Ops sync may update Goodshuffle-sourced fields and flag removed lines, but never overwrites ticks, notes, or items/tasks the team added.
- Dates: business days and "today" are America/Toronto. Use `src/lib/dates.ts`.

## Design system ("the atelier")

Tokens live in `src/app/globals.css` (`@theme`); pages never hard-code colours, shadows or radii.
- Palette (brand, unchanged identity): ink #17201C, bloom #BC5468 (accent: primary create actions, alerts), stem #5F8568 / stem-strong #456A50 (success, text on soft green), sage #8AA890, amber #9C6A1E. Surfaces: paper #F5F3EE (canvas), paper-2 (sunken), card #FFF, card-2 #FAF9F6 (table heads, insets). Lines: edge #E5E0D6, edge-strong #D3CCBF. Text: ink, muted #646158 (secondary, ≥4.5:1), faint (placeholders/decoration only).
- Type: Fraunces (display serif: page titles, section titles, big numbers) + Geist (UI). Page title 28/34px, section 19px, card heading 17px, body 14px, captions 12–13px. Eyebrows are the only uppercase text.
- Shape & depth: controls 8px radius, cards 12px, pills full; shadow-xs on cards/controls, shadow-lg only for popovers/drawers.
- Components (utilities in globals.css): `btn`, `btn-primary` (ink), `btn-bloom` (one primary create action per screen), `btn-ghost`, `btn-danger`, `btn-sm`; `input` (also selects/textarea/file), `label`, `hint`; `card`, `eyebrow`; `chip`; `th`/`td`; `seg`/`seg-item` (segmented control, `aria-current="page"` marks the active item); `.check-chip` (checkbox as a toggle pill). Status colours come from `STATUS_TONE` in `src/components/badges.tsx`.
- Layout: `Shell` (`src/components/shell.tsx`): desktop sidebar (division switcher, section nav, notifications, user) and a phone top bar + drawer; every page starts with `PageHeader` (`src/components/page-header.tsx`). Icons: lucide-react, 15–17px, stroke 1.75.
- Wide tables get a stacked list on phones (see leads) or scroll inside their card; the page itself never scrolls sideways.
- Motion ~150ms ease-out; respect `prefers-reduced-motion`. Focus ring: 2px bloom.
- Chart colours are in `src/lib/chart-colors.ts` (validated for colour-vision deficiency; re-run the validator if you change them).

## After each change

`pnpm typecheck && pnpm test` (needs local Postgres; see README).
