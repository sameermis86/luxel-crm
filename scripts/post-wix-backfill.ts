import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { mapWixPayload, mapEventType } from "@/lib/wix-mapping";

/**
 * Post exported Wix submissions to the live intake endpoint in backfill mode.
 * Input: JSON array of { id, form, createdDate, answers: { "Label [target]": value } }.
 *   tsx scripts/post-wix-backfill.ts <file> --dry-run       # stats only, nothing sent
 *   WIX_INTAKE_SECRET=… tsx scripts/post-wix-backfill.ts <file> https://luxel-crm.vercel.app
 * Prints aggregate counts only (no personal data).
 */
type Row = { id: string; form: string; createdDate: string; answers: Record<string, string> };

const OCCASION_TARGETS = ["multi_choice_d611"];

/** Event Contact Form has no "occasion" question: infer it only from explicit words in the answers. */
function inferOccasion(text: string): string | null {
  const t = text.toLowerCase();
  if (/bridal shower|baby shower|shower/.test(t)) return "Social Events";
  if (/baptism|christening|communion|birthday|sweet 16|anniversary|graduation/.test(t)) return "Social Events";
  if (/corporate|holiday dinner|fundraiser|gala|charity|company|conference|prom/.test(t)) return "Corporate Events";
  if (/wedding|bride|bridal|groom|fianc|ceremony|reception|married|sweetheart|bouquet|boutonni|aisle|altar|chuppah|mandap/.test(t)) return "Wedding";
  return null;
}

export function toPayload(r: Row) {
  const submissions: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.answers)) {
    const target = k.match(/\[([^\]]+)\]$/)?.[1] ?? k;
    submissions[OCCASION_TARGETS.includes(target) ? "occasion" : target] = v;
  }
  const allText = Object.values(r.answers).join(" ");
  if (!submissions.occasion) {
    // no occasion and nothing explicit: BACKFILL_DEFAULT_OCCASION (Luxel chose "Wedding" for the Event Contact Form)
    const inferred = inferOccasion(allText) ?? process.env.BACKFILL_DEFAULT_OCCASION ?? null;
    if (inferred) submissions.occasion = inferred;
  }
  const tier = allText.match(/\((Effortless|Elegant|Elevated)\)/i)?.[1];
  if (tier) submissions.tier = tier;
  return { id: r.id, form: "contact_us", formName: r.form, createdDate: r.createdDate, submissions };
}

async function main() {
  const [file, target] = process.argv.slice(2);
  const rows: Row[] = JSON.parse(readFileSync(file, "utf8"));
  const dry = !target || target === "--dry-run";
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const results: Record<string, number> = {};
  const secret = process.env.WIX_INTAKE_SECRET;
  if (!dry && !secret) throw new Error("WIX_INTAKE_SECRET is not set");

  for (const r of rows) {
    const payload = toPayload(r);
    const m = mapWixPayload(payload, { defaultForm: "contact_us" });
    bump(`form:${r.form}`);
    bump(`eventType:${m.input.eventType ?? "unknown"}`);
    for (const f of ["firstName", "lastName", "email", "phone", "eventDate", "venueName", "budgetMax", "guestCount", "message", "tierInterest"] as const) {
      if (m.input[f] != null && m.input[f] !== "") bump(`has:${f}`);
    }
    if (Object.keys(m.unmapped).length) for (const k of Object.keys(m.unmapped)) bump(`unmapped:${k}`);
    if (dry) continue;
    const raw = JSON.stringify(payload);
    const res = await fetch(`${target}/api/intake/wix?backfill=1&form=contact_us`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-luxel-signature": "sha256=" + createHmac("sha256", secret!).update(raw).digest("hex") },
      body: raw,
    });
    const body = (await res.json().catch(() => ({}))) as { outcome?: string };
    const key = res.ok ? body.outcome ?? "ok" : `http_${res.status}`;
    results[key] = (results[key] ?? 0) + 1;
  }
  console.log("rows:", rows.length);
  console.log("mapping:", Object.fromEntries(Object.entries(stats).sort()));
  if (!dry) console.log("results:", results);
}

main();
