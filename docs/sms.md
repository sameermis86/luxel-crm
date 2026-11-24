# Text reminders (office iPhone, one-tap)

The office number is a Fido iPhone. iOS doesn't let apps send texts in the background, so texts go out
one tap at a time from the phone's own Messages app, from the office number, at no cost.

- **Texts to send** (`/texts`): leads waiting on a follow-up that may be texted now, most overdue first.
  Pick a template, adjust, **Open in Messages** (an `sms:` link fills in the number and text), send, then
  **Mark as sent**, which logs a `text_logged` event (timeline "Text sent from the office phone"): counts as
  contact (New → Contacted), closes follow-ups due now, and sets the next follow-up if none.
- **Lead page → Text reminder**: the same composer for one lead, plus **They asked not to be texted**
  (`leads.sms_opt_out_at`). Replies arrive on the iPhone only; tick this when someone replies STOP.
- **Rules** (`smsEligibility` in `src/lib/sms.ts`, CASL): a mobile number (+1), not opted out, lead open, inquired within
  `sms.consentDays` (183: implied consent from an inquiry lasts 6 months), and not texted in the last
  `sms.minDaysBetween` days (queue only; a person can text sooner from the lead page). Every text names the sender
  (`sms.senderName`) and ends with "Reply STOP to opt out." (`renderSms` adds them if a template doesn't).
- **Templates**: Settings → Text reminders. Placeholders `{first_name} {event} {event_date} {venue} {sender}`.

On a Mac signed in to the same Apple ID with iPhone Text Message Forwarding on, the `sms:` links open Messages
on the Mac and send from the iPhone's number too.

# Reminder emails (reviewed, sent from info@)

Same page (**Reminders**, `/reminders`; `/texts` redirects) and the lead page **Reminder** panel have an **Email** tab.
Pick a template, edit subject and text, click **Send email** (with a confirm). Never automatic.

- Sent over SMTP with the mailbox login (`MAILBOX_IMAP_USER` / `MAILBOX_IMAP_PASSWORD`; host `MAILBOX_SMTP_HOST` or the IMAP
  host, port `MAILBOX_SMTP_PORT` 465), from "{sender name}" <info@…>, reply-to info@. The exact message is also saved to the
  mailbox's Sent folder (IMAP append; if that fails the send still counts and the UI says so).
- Logged on the lead as an outbound email (`via: "crm"`, `messageId`). The mailbox sync sees the copy in Sent with the same
  Message-ID and doesn't log it again. Counts as contact like any email; sets the next follow-up if none.
- Rules: `emailEligibility` (same CASL consent window as texts, valid address, not unsubscribed, lead open). The queue's
  spacing counts the last text or outbound email of either kind.
- Every email ends with the sender name, Settings → Reminders: emails → sign-off, and an unsubscribe link:
  `/unsubscribe/<token>` (public; HMAC token from `UNSUBSCRIBE_SECRET`, falling back to `CRON_SECRET`). The link opens a
  confirm button (POST) so mail scanners can't unsubscribe anyone; it sets `leads.email_opt_out_at`. Staff can also tick
  **Unsubscribed from emails** on the lead.
