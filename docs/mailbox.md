# Mailbox (info@luxeldecor.com)

Every scheduled sync reads the shared mailbox over IMAP and logs client emails on lead timelines.

- **Reads:** every folder except trash, spam, junk and drafts (`skipFolder`), headers only (from, to, cc, date, subject, Message-ID). Never bodies; never
  sends, moves, flags or deletes anything. First run goes back `mailbox.backfillDays` (700), `mailbox.batchSize` (1500) messages per
  folder per sync, oldest first; after that only new messages (by IMAP UID, resuming where it stopped).
- **Direction comes from the sender** (`directionOf`): from our domain = we sent it, wherever it's filed.
- **We emailed a lead:** logged as an outbound email (timeline "Email sent", subject as the summary,
  `via: "mailbox"`). Sets last contacted, moves New → Contacted, and closes open follow-ups that were due by
  the email's time + `mailbox.followUpGraceHours` (12h). An email sent well before a follow-up was due
  doesn't close it. An open lead left with no follow-up gets the next one from the email's date.
- **A lead emailed us** (any subject): logged as received (`role: "from"`); counts as contact (last contacted, New → Contacted)
  but keeps the follow-up open: they're waiting on us.
- **A lead copied** on someone else's email to us (e.g. a planner): logged as "received (client copied)" (`role: "cc"`),
  no status change.
- **Audit:** every change is on the lead's timeline (`via: "mailbox"`, with folder and role); every run that logged
  something adds a `sync.mailbox` entry to Admin → Audit log (emails read/logged, leads, moved to Contacted,
  follow-ups closed, folders read).
- Matching is by the lead's email (merged/archived leads ignored). Our own domain and Settings → Planners &
  partners are never matched. Each message is logged once per lead (Message-ID, so the same email in two folders counts once).

## Connecting
Vercel → luxel-crm → Settings → Environment Variables (Production), then redeploy:
- `MAILBOX_IMAP_USER` = `info@luxeldecor.com`
- `MAILBOX_IMAP_PASSWORD` = the mailbox password (mark **Sensitive**)
- optional `MAILBOX_IMAP_HOST` (default `mail.<domain>`, i.e. mail.luxeldecor.com) and `MAILBOX_IMAP_PORT` (993)

Status and errors: Import page → Mailbox. `POST /api/cron/wix-sync?only=mailbox` runs just this step.
