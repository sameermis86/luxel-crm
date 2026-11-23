# Wix → Luxel CRM integration

Every website inquiry lands in the CRM as a scored, assigned lead with a first
follow-up due within 2 business hours. Two forms feed it:

| Form on luxeldecor.com | How it reaches the CRM | Auth |
|---|---|---|
| **Estimator / Quote Builder** (custom Velo) | `fetch()` from the existing Velo backend function | `Authorization: Bearer <secret>` (or HMAC) |
| **Contact forms** (Wix Forms: "Event Contact Form", "Contact") | Wix Automation: *Form submitted → Send HTTP request* | `?token=<secret>` in the URL |

Endpoint: `POST https://<crm-domain>/api/intake/wix`

The endpoint is idempotent. Send `submission_id` and a repeat is ignored
(`"outcome": "duplicate_submission"`). If there's no id (Automations), the CRM
fingerprints the content, so a retried webhook still doesn't create a second lead.
A `5xx` means "retry", and retries are safe.

Checked against Wix's current docs (Nov 2026):
- `wix-fetch` `fetch()`: https://dev.wix.com/docs/velo/apis/wix-fetch/fetch
- Secrets Manager `getSecretValue`: https://dev.wix.com/docs/api-reference/business-management/secrets/get-secret-value?apiView=SDK
- Automations "Send HTTP request": https://support.wix.com/en/article/the-new-automation-builder-sending-data-via-webhook
  (no custom headers are documented, which is why the Automation passes the token in the URL)
- Forms submissions REST API (backfill): https://dev.wix.com/docs/api-reference/crm/forms/skills/read-forms-and-submissions
- Velo's `wix-forms.v2` docs list no submission-created backend event for Editor sites,
  so the contact forms use the Automation rather than an `events.js` handler.

---

## 1. Shared secret

1. Generate a long random secret (e.g. `openssl rand -hex 32`).
2. In the CRM's environment set `WIX_INTAKE_SECRET=<secret>`.
3. In Wix: **Dashboard → Developer Tools → Secrets Manager**, add a secret named
   `LUXEL_CRM_INTAKE_SECRET` with the same value.

Rotate it by changing both places. The Automation URL in step 3 needs updating too.

---

## 2. Quote Builder (Velo)

Add a backend file `backend/luxelCrm.js`:

```javascript
// backend/luxelCrm.js
import { fetch } from 'wix-fetch';
import { secrets } from '@wix/secrets';
import { auth } from '@wix/essentials';

const CRM_URL = 'https://<crm-domain>/api/intake/wix';

/**
 * Forward a Quote Builder lead to the Luxel CRM. Never throws: the visitor's
 * estimate flow must not fail because the CRM is down. Wix keeps its own copy.
 */
export async function sendToLuxelCrm(lead) {
  try {
    const getSecret = auth.elevate(secrets.getSecretValue);
    const { value: secret } = await getSecret('LUXEL_CRM_INTAKE_SECRET');
    const response = await fetch(CRM_URL, {
      method: 'post',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secret}` },
      body: JSON.stringify(lead),
    });
    if (!response.ok) console.error('Luxel CRM intake failed', response.status, await response.text());
  } catch (err) {
    console.error('Luxel CRM intake error', err);
  }
}
```

Then in the **existing** HTTP function that captures the estimate
(`backend/http-functions.js`), call it **after** the current capture and email logic:

```javascript
import { sendToLuxelCrm } from 'backend/luxelCrm';

// ...inside your existing post_<name>(request) handler, after saving the lead
// and sending the branded estimate email:
await sendToLuxelCrm({
  form: 'quote_builder',
  submission_id: savedLead._id,          // any stable id you already have for this submission
  submitted_at: new Date().toISOString(),
  first_name: body.firstName,
  last_name: body.lastName,
  partner_name: body.partnerName,        // optional
  email: body.email,
  phone: body.phone,
  event_type: body.eventType,            // "Wedding" | "Corporate" | "Social" | "Rentals"…
  event_date: body.eventDate,            // "2027-06-12" (other common formats also accepted)
  venue_name: body.venue,
  venue_city: body.venueCity,
  guest_count: body.guests,
  tier: body.tier,                       // "Effortless" | "Elegant" | "Elevated" | "Custom"
  estimate_total: body.estimateTotal,    // number
  services: body.services,               // array or comma-separated string
  message: body.notes,
  // attribution: capture these on the page (see below) and pass them through
  utm_source: body.utm_source,
  utm_medium: body.utm_medium,
  utm_campaign: body.utm_campaign,
  utm_content: body.utm_content,
  utm_term: body.utm_term,
  landing_page: body.landing_page,
  referrer: body.referrer,
});
```

Field names are matched by meaning, so `firstName`, `first_name` and "First name"
all work. Unknown fields are kept in the raw payload on the lead's timeline.

**Capturing UTMs on the Quote Builder page.** On the visitor's first page view,
save the `utm_*` query parameters, the landing URL and the referrer (if your page
code can read it) to session storage, then include them in what the estimator
sends to the backend. Velo's `wix-location-frontend` and `wix-storage-frontend`
modules cover this; check their current docs for the exact calls. Without UTMs
the CRM still attributes the lead to the Quote Builder.

**Optional HMAC instead of Bearer.** If you prefer not to send the secret on the
wire, sign the exact body string: header `X-Luxel-Signature: sha256=<hex HMAC-SHA256(body, secret)>`.

---

## 3. Contact forms (Wix Automation)

For each contact form ("Event Contact Form" and "Contact"):

1. **Automations → + Create Automation → Start from Scratch.** Name it "Send to Luxel CRM: <form name>".
2. **Trigger:** *Form submitted*, using the blue icon for new Wix Forms, then **Specific** → choose the form.
3. **+ → Action → Send HTTP request.**
   - **Method:** POST
   - **URL:** `https://<crm-domain>/api/intake/wix?token=<secret>&form=contact_us`
   - **Request body:** *All automation data* works (the CRM matches fields by label).
     For cleaner payloads use *Choose fields* with these keys:
     `submission_id` (Submission ID, if offered), `first_name`, `last_name` (or `full_name`),
     `email`, `phone`, `event_date`, `event_venue`, `guests`, `budget`, `occasion`,
     `services`, `message`.
   - "Nest request body under data" can be on or off. Both are handled.
4. **Activate**, then submit a test entry on the live site and check it appears in the CRM.

> The token is in the URL because the Automation's HTTP action doesn't document
> custom headers. Use a dedicated secret for this, and rotate it if the URL is
> ever shared.

---

## 3b. Scheduled sync (pull) — always on once connected

Independently of the push above, the CRM pulls from Wix every 15 minutes:

- **Wix Forms** submissions (all forms except job applications / newsletter sign-ups)
- the **Quote Builder**'s CMS collection `QuoteLeads` (which the push in step 2 doesn't need to exist for)

Rules: leads whose event date has passed are skipped; leads with no event date are kept only if submitted in the last ~6 months.
Event Contact Form inquiries with no explicit occasion are treated as weddings. Everything is idempotent (keyed on the Wix id),
so push + pull together never double-count.

The very first run imports existing records as a **backfill** (original dates, no assignment or follow-up). From then on,
new submissions arrive as live leads (assigned, scored, first follow-up).

Setup:

1. **Wix API key** — Wix account → *API Keys Manager* → Generate API Key. Permissions: **Wix Forms** (read submissions/forms)
   and **Wix Data / CMS** (read data items). Copy the key.
2. **Vercel** → project `luxel-crm` → Settings → Environment Variables → add `WIX_API_KEY` (Production + Preview, mark Sensitive), then redeploy.
   `WIX_SITE_ID` and `CRON_SECRET` are already set.
3. **GitHub** → repo `luxel-crm` → Settings → Secrets and variables → Actions → New repository secret `CRON_SECRET`
   with the same value as Vercel's `CRON_SECRET` (Vercel: Environment Variables → CRON_SECRET → reveal).
   This powers the 15-minute schedule (`.github/workflows/wix-sync.yml`). Vercel Cron also runs it once a day as a backup.
4. Check **Import → Wix sync** in the CRM: last run time and counts; **Sync now** runs it on demand.

The endpoint is `POST /api/cron/wix-sync` with `Authorization: Bearer <CRON_SECRET>`.

## 4. Testing

```bash
pnpm intake:test                         # posts sample Quote Builder + Contact payloads to localhost, twice each
pnpm intake:test https://<crm-domain>    # same against a deployment
```

The second post of each sample returns `"outcome": "duplicate_submission"`.

## 5. Backfill historical submissions

```bash
pnpm backfill:wix --api --dry-run        # preview (needs WIX_API_KEY + WIX_SITE_ID)
pnpm backfill:wix --api                  # import every Wix Forms submission (newsletter form skipped)
pnpm backfill:wix --csv contact.csv --form contact_us   # or a CSV exported from the Forms dashboard
```

Backfilled leads keep their original submission time, are attributed to `import`,
go through duplicate matching (an exact match updates blanks on the existing lead
instead of creating one), and don't get an automatic follow-up. Re-running is
safe.

The Luxel site ID is `670dd5b5-aada-4b40-9915-cf249780f7ae`. Create the API key in the
Wix API Keys Manager with Wix Forms read permission.
