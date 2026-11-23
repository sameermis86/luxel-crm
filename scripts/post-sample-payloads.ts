import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";

/**
 * Posts sample Wix payloads to the intake endpoint, the same way Wix will.
 *   pnpm intake:test                      # against http://localhost:3000
 *   pnpm intake:test https://crm.example  # against a deployment
 * Sends each sample twice to show idempotency (second response: duplicate_submission).
 */
const base = process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.WIX_INTAKE_SECRET!;
const run = randomUUID().slice(0, 8);

const samples: { name: string; auth: "hmac" | "query"; body: Record<string, unknown> }[] = [
  {
    name: "Quote Builder (Velo, HMAC)",
    auth: "hmac",
    body: {
      form: "quote_builder",
      submission_id: `qb-${run}`,
      submitted_at: new Date().toISOString(),
      first_name: "Alessia",
      last_name: "Marino",
      partner_name: "Luca Conti",
      email: `alessia.marino+${run}@example.com`,
      phone: "905-555-0142",
      event_type: "Wedding",
      event_date: "2027-09-18",
      venue_name: "Hazelton Manor",
      venue_city: "Vaughan",
      guest_count: 220,
      tier: "Elevated",
      estimate_total: 14800,
      services: ["Centerpieces", "Ceremony", "Backdrop"],
      message: "Ivory and sage, lots of greenery.",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "fall-wedding-2027",
      landing_page: "https://www.luxeldecor.com/estimate",
      referrer: "https://www.google.com/",
    },
  },
  {
    name: "Contact Us (Automation, token in URL, labels nested under data)",
    auth: "query",
    body: {
      data: {
        "First name": "Jordan",
        "Last name": "Lee",
        Email: `jordan.lee+${run}@example.com`,
        Phone: "416-555-0175",
        "Leave us a message...": "Looking for gala centerpieces for 40 tables.",
        "Event Venue": "Liberty Grand",
        "Event Date": "2027-03-06",
      },
    },
  },
];

(async () => {
  for (const s of samples) {
    for (const attempt of [1, 2]) {
      const raw = JSON.stringify(s.body);
      const headers: Record<string, string> = { "content-type": "application/json" };
      let url = `${base}/api/intake/wix`;
      if (s.auth === "hmac") headers["x-luxel-signature"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
      else url += `?token=${encodeURIComponent(secret)}&form=contact_us`;
      const t = Date.now();
      const res = await fetch(url, { method: "POST", headers, body: raw });
      console.log(`${s.name} #${attempt}: ${res.status} ${Date.now() - t}ms`, await res.text());
    }
  }
})();
