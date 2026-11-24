# Goodshuffle Pro → CRM status sync

Goodshuffle Pro has no public API. It does sync every project to Google Calendar, with one
calendar per project status. The CRM reads those calendars through their private iCal links
on the same 15-minute schedule as the Wix sync.

| Goodshuffle | CRM |
|---|---|
| Quote Sent | Proposal sent (only if the lead hasn't got that far) |
| Signed / Action Needed | Won |
| Lost | Lost (reason "Marked lost in Goodshuffle Pro") |
| New | no change |

Leads only move forward. Lost leads are never reopened and unqualified leads are left alone.
Every change is in the lead's timeline, tagged "via Goodshuffle".

**Matching.** An email or phone in the calendar event that belongs to exactly one lead wins.
Otherwise the lead must have the same event date (±1 day) and a matching name, clearly ahead
of any other candidate. Anything unsure is listed under "not matched" instead of guessed.

## Setup

1. Google Calendar (the account Goodshuffle syncs to) → hover a Goodshuffle status calendar →
   ⋮ → Settings and sharing → **Secret address in iCal format** → copy.
2. Vercel → `luxel-crm` → Settings → Environment Variables (Production, Sensitive):
   - `GOODSHUFFLE_ICAL_QUOTE_SENT`
   - `GOODSHUFFLE_ICAL_SIGNED`
   - `GOODSHUFFLE_ICAL_ACTION_NEEDED`
   - `GOODSHUFFLE_ICAL_LOST`
   - (`GOODSHUFFLE_ICAL_NEW` is optional; it never changes a status)
   Then redeploy.
3. CRM → Import → **Goodshuffle Pro** → *Check now*. Review the proposed changes, then
   *Apply*, and tick **Automatic updates** to let every sync apply them.

The secret iCal address gives read access to that calendar; keep it only in Vercel. If it
leaks, use "Reset" next to it in Google Calendar and update Vercel.

## Stage tags and new leads (added later)
- Every matched lead gets `goodshuffle_status` (its Goodshuffle stage) and `goodshuffle_project` (project number).
  These are always written, in preview mode too: they describe Goodshuffle and don't change the CRM status.
  The dashboard's Quotes numbers come from this tag.
- A project with no lead in the CRM (no lead on that event date, or none with a matching name) becomes a lead:
  source/channel Goodshuffle, client name, phone/email from the event, venue, event date, CRM status from the stage.
  Later runs find it again by project number. Ambiguous projects ("more than one lead could match") stay in the review list.
- Lead creation is off until switched on (`goodshuffle_settings.createLeads`); `POST /api/cron/wix-sync?goodshuffle=create-leads`
  switches it on and runs once. Only projects whose event is after today become leads, dated the day they were created (the feed has no real creation date: every entry is stamped when the calendar sync was connected).

