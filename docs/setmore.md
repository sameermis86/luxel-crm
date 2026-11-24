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
- **Status updates (owners):** the panel previews leads whose bookings support a forward move — a booking
  that has ended → Consult held, one still ahead → Consult scheduled — and **Apply** makes them through
  `updateLead` (timeline: "from a Setmore booking"). Only New, Contacted, Not reachable and Consult scheduled
  leads move; won, lost, unqualified and on-hold leads and cancelled bookings are ignored. Rule:
  `plannedConsultStatus` in `src/lib/setmore.ts`.
- A booking with no matching lead shows **Add as lead**: it creates the lead (Consult scheduled if the
  booking is ahead, Consult held if it's past) through the normal intake path and links the booking.
- Never creates, changes or cancels anything in Setmore.

## Connecting
1. Setmore Pro plan, then email api@setmore.com asking for API access (read-only sync of our own
   appointments and customers into our lead tracker). They reply with a permanent refresh token.
2. Vercel → luxel-crm → Settings → Environment Variables → `SETMORE_REFRESH_TOKEN` (Sensitive), redeploy.
3. The panel fills in on the next sync (within 15 minutes). Errors show in the panel.
