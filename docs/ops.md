# Fulfillment & Ops division

Luxel's app is organised by division (switcher at the top): **Sales & CRM** (this lead desk),
**Fulfillment & Ops**, and **Floral orders** (next phase).

## Event board (`/ops`)
Every signed Goodshuffle contract (the Signed and Action Needed calendars) with its event date, venue and
progress: items pulled, setup tasks done, teardown done (and items returned, once the event has passed).
Views: next 60 days, next 7 days, past events (kept for `settings.ops.keepDaysAfter` days, default 14).

## Event page (`/ops/events/:id`)
- **Pull sheet:** Goodshuffle's lines grouped by area (Head table, Guest tables, Lobby…) with quantities.
  Goodshuffle only puts top-level packages in the calendar, so the team adds the pieces under each package
  ("Gold chargers × 16"). Every line has Pulled / Loaded / Returned ticks (who and when is recorded) and a note.
  Printable. Links to Goodshuffle's own printed pull sheets (those need a Goodshuffle login).
- **Setup / Teardown:** checklists per area from the templates in `settings.ops` (`{area}` is replaced),
  plus one task per logistics line (drop-offs → setup, pickups → teardown). The team can add their own.
  Teardown also has a "count back in" list of every item.
- **Details:** client, times, venue, sales lead, contract notes (client-visible and internal), Goodshuffle links.

## Sync
`runOpsSync` (`src/server/ops/sync.ts`) runs with the 15-minute scheduled sync and from "Sync from Goodshuffle".
One event per project number. Re-runs update quantities, add new lines/tasks, flag lines removed in Goodshuffle,
and never touch ticks, notes or anything the team added. An upcoming event that leaves the signed calendars is
flagged "no longer signed", not deleted. Parsing lives in `src/lib/ops-parse.ts`.
