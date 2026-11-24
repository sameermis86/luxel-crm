# Setmore consultations

The Leads page has a **Consultations** panel: who is booked to meet soon (next 30 days) and who met
in the last 14 days, each linked to their lead. The leads table has a **Consultation** column with
the next booked time, and `/leads?consult=upcoming` lists every lead with a booking ahead.

## How it works
- Runs with the scheduled sync (`/api/cron/wix-sync`, every 15 min) when `SETMORE_REFRESH_TOKEN` is set.
- Reads Setmore API v2: staff → bookings per staff member (60 days back, 120 ahead, in 30-day slices)
  → customers. Customers already stored aren't fetched again.
- Stores a read-only copy in `appointments` (one row per booking, upserted on the Setmore id).
- Links each booking to a lead by exact email, then phone. The sync itself doesn't change lead statuses.
- **Status updates (automatic):** every sync moves leads whose bookings support a forward move — a booking
  that has ended → Consult held, one still ahead → Consult scheduled — through `updateLead`. Between syncs
  owners see what's waiting in the panel and can **Apply** it straight away (timeline: "from a Setmore booking"). Only New, Contacted, Not reachable and Consult scheduled
  leads move; won, lost, unqualified and on-hold leads and cancelled bookings are ignored. Rule:
  `plannedConsultStatus` in `src/lib/setmore.ts`.
- **Every sync, after storing bookings** (`applyBookings`):
  1. A booking with no email/phone match is linked to the one live lead with the same full name (no link
     when two leads share the name or only a first name is known).
  2. Otherwise a lead is created (source Other, "Setmore booking", dated at the first booking), with the
     furthest stage its confirmed bookings show: services containing `setmore.wonServices`
     ("existing booking") → Won, `setmore.proposalServices` ("quote review") → Proposal sent, other
     consultations → Consult held / Consult scheduled. People with only cancelled bookings aren't added.
  3. Linked leads move forward (below).
  4. An open lead with a consultation ahead isn't "awaiting follow-up": its overdue follow-ups are closed
     ("consultation booked in Setmore") and the next follow-up is set for the meeting. A follow-up someone
     set for later is left alone.
- Between syncs, a booking with no matching lead shows **Add as lead**: it creates the lead (Consult scheduled if the
  booking is ahead, Consult held if it's past) through the normal intake path and links the booking.
- Never creates, changes or cancels anything in Setmore.

## Connecting
1. Setmore Pro plan, then email api@setmore.com asking for API access (read-only sync of our own
   appointments and customers into our lead tracker). They reply with a permanent refresh token.
2. Vercel → luxel-crm → Settings → Environment Variables → `SETMORE_REFRESH_TOKEN` (Sensitive), redeploy.
3. The panel fills in on the next sync (within 15 minutes). Errors show in the panel.
