import "dotenv/config";
import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { closeDb } from "@/db/client";
import { handleWixSubmission } from "@/server/intake/wix";

/**
 * One-off backfill of historical Wix form submissions. Safe to re-run: every
 * submission is keyed by its Wix submission id (or a content fingerprint), so
 * repeats are skipped. Backfilled leads keep their original submission time,
 * are recorded with actor_kind = import, and get no auto follow-up.
 *
 *   pnpm backfill:wix --api                       # Wix Forms REST API (WIX_API_KEY + WIX_SITE_ID)
 *   pnpm backfill:wix --api --form-id <uuid>      # just one form
 *   pnpm backfill:wix --csv export.csv --form contact_us   # a CSV exported from the Forms dashboard
 *   add --dry-run to print what would be imported
 *
 * REST endpoints (Wix docs, "Read Forms and Submissions"):
 *   POST https://www.wixapis.com/form-schema-service/v4/forms/query
 *   POST https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query
 */

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY = flag("dry-run");
const NAMESPACE = "wix.form_app.form";

type Tally = Record<string, number>;
const tally: Tally = {};
const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);

async function ingest(body: unknown, defaultForm: "quote_builder" | "contact_us") {
  if (DRY) {
    const { mapWixPayload } = await import("@/lib/wix-mapping");
    const m = mapWixPayload(body, { defaultForm });
    console.log(JSON.stringify({ id: m.submissionId, at: m.submittedAt, ...m.input }));
    bump("would_import");
    return;
  }
  const r = await handleWixSubmission(body, { backfill: true, defaultForm });
  bump(r.outcome);
}

async function wix(path: string, body: unknown) {
  const key = process.env.WIX_API_KEY;
  const site = process.env.WIX_SITE_ID;
  if (!key || !site) throw new Error("Set WIX_API_KEY and WIX_SITE_ID (or use --csv)");
  const res = await fetch(`https://www.wixapis.com${path}`, {
    method: "POST",
    headers: { Authorization: key.startsWith("Bearer ") ? key : `Bearer ${key}`, "wix-site-id": site, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Wix ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<any>;
}

/** formId → { name, labels: target → label } so answers can be matched by their human label. */
async function loadForms() {
  const out = new Map<string, { name: string; labels: Record<string, string> }>();
  let cursor: string | undefined;
  do {
    const page = await wix("/form-schema-service/v4/forms/query", {
      query: cursor ? { cursorPaging: { limit: 50, cursor } } : { filter: { namespace: { $eq: NAMESPACE } }, cursorPaging: { limit: 50 } },
    });
    for (const f of page.forms ?? []) {
      const labels: Record<string, string> = {};
      for (const field of [...(f.fields ?? []), ...(f.formFields ?? [])]) {
        const target = field.target ?? field.inputOptions?.target;
        const label = JSON.stringify(field).match(/"label":"([^"]+)"/)?.[1];
        if (target && label) labels[target] = label;
      }
      out.set(f.id, { name: f.name, labels });
    }
    cursor = page.metadata?.hasNext ? page.metadata.cursors?.next : undefined;
  } while (cursor);
  return out;
}

const formKind = (name: string): "quote_builder" | "contact_us" | null =>
  /subscri|newsletter/i.test(name) ? null : /quote|estimat/i.test(name) ? "quote_builder" : "contact_us";

async function fromApi() {
  const forms = await loadForms();
  const only = opt("form-id");
  console.log(`forms: ${[...forms.values()].map((f) => f.name).join(", ")}`);
  let cursor: string | undefined;
  do {
    const filter: Record<string, unknown> = { namespace: NAMESPACE, ...(only ? { formId: only } : {}) };
    const page = await wix("/form-submission-service/v4/submissions/namespace/query", {
      query: cursor ? { cursorPaging: { limit: 100, cursor } } : { filter, sort: [{ fieldName: "createdDate", order: "ASC" }], cursorPaging: { limit: 100 } },
    });
    for (const s of page.submissions ?? []) {
      const form = forms.get(s.formId);
      const kind = formKind(form?.name ?? "");
      if (!kind) {
        bump("skipped_newsletter");
        continue;
      }
      // keep the raw target keys AND add the human labels, so the mapper can use either
      const labelled: Record<string, unknown> = {};
      for (const [target, value] of Object.entries(s.submissions ?? {})) {
        labelled[target] = value;
        const label = form?.labels[target];
        if (label) labelled[label] = value;
      }
      await ingest({ id: s.id, formId: s.formId, form: kind, formName: form?.name, createdDate: s.createdDate, submissions: labelled }, kind);
    }
    cursor = page.metadata?.hasNext ? page.metadata.cursors?.next : undefined;
  } while (cursor);
}

async function fromCsv(file: string) {
  const kind = (opt("form") as "quote_builder" | "contact_us") ?? "contact_us";
  const { data } = Papa.parse<Record<string, string>>(readFileSync(file, "utf8"), { header: true, skipEmptyLines: true });
  for (const row of data) {
    const at = row["Submission time"] ?? row["Submission Time"] ?? row["Created date"] ?? row["Date"];
    const id = row["Submission ID"] ?? row["Submission Id"] ?? row["ID"];
    await ingest({ ...row, form: kind, ...(id ? { submission_id: id } : {}), ...(at ? { submitted_at: at } : {}) }, kind);
  }
}

(async () => {
  try {
    if (flag("api")) await fromApi();
    else if (opt("csv")) await fromCsv(opt("csv")!);
    else {
      console.log("usage: pnpm backfill:wix --api [--form-id <id>] | --csv <file> [--form contact_us|quote_builder]  [--dry-run]");
      process.exit(1);
    }
    console.log("backfill done:", tally);
  } finally {
    await closeDb();
  }
})();
