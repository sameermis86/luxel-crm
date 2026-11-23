import { eq, and } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { integrationState } from "@/db/schema";
import { dateInTz } from "@/lib/dates";
import {
  formSubmissionToPayload,
  isLeadForm,
  quoteLeadCreatedAt,
  quoteLeadToPayload,
  shouldImport,
  submissionEventDate,
  type QuoteLeadItem,
  type WixFormSubmission,
} from "@/lib/wix-sources";
import { handleWixSubmission } from "./wix";

/**
 * Scheduled pull from Wix (Option 2). Every run:
 *  1. reads Wix Forms submissions and Quote Builder (QuoteLeads) items created since the last cursor
 *     (minus an overlap window, so nothing slips through a slow write)
 *  2. skips non-lead forms and leads whose event date has passed
 *  3. sends each through the normal intake pipeline (idempotent on the Wix id)
 *
 * Records created before the sync was first switched on are imported as a backfill
 * (original date, no assignment / follow-up). Everything after is a live lead.
 */

export interface WixClient {
  listForms(): Promise<{ id: string; name: string; labels: Record<string, string> }[]>;
  submissionsSince(sinceIso: string): Promise<WixFormSubmission[]>;
  quoteLeadsSince(sinceIso: string): Promise<QuoteLeadItem[]>;
}

const STATE_KEY = "wix_sync";
const OVERLAP_MS = 6 * 3600_000;
const FORMS_NS = "wix.form_app.form";

export interface SyncState {
  liveSince?: string;
  formsCursor?: string;
  quoteLeadsCursor?: string;
  lastRunAt?: string;
  lastResult?: SyncResult;
  lastError?: string | null;
}

export interface SyncResult {
  checked: number;
  created: number;
  attached: number;
  alreadyImported: number;
  skippedPastEvent: number;
  skippedNotLead: number;
  failed: number;
  backfilled: number;
  /** stopped early to stay inside the function time limit; the next run continues */
  more?: boolean;
}

export async function getSyncState(orgId: string): Promise<SyncState> {
  const ctx = systemCtx(orgId);
  const [row] = await withCtx(ctx, (tx) =>
    tx.select().from(integrationState).where(and(eq(integrationState.orgId, orgId), eq(integrationState.key, STATE_KEY))),
  );
  return (row?.value as SyncState) ?? {};
}

async function saveSyncState(orgId: string, value: SyncState) {
  const ctx = systemCtx(orgId);
  await withCtx(ctx, (tx) =>
    tx
      .insert(integrationState)
      .values({ orgId, key: STATE_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [integrationState.orgId, integrationState.key], set: { value, updatedAt: new Date() } }),
  );
}

export async function runWixSync(orgId: string, client: WixClient, now = new Date(), opts: { budgetMs?: number } = {}): Promise<SyncResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 45_000;
  const outOfTime = () => Date.now() - started > budgetMs;
  const state = await getSyncState(orgId);
  const liveSince = state.liveSince ?? now.toISOString();
  const epoch = "2000-01-01T00:00:00.000Z";
  const since = (c?: string) => (c ? new Date(new Date(c).getTime() - OVERLAP_MS).toISOString() : epoch);
  const today = dateInTz(now);
  const r: SyncResult = { checked: 0, created: 0, attached: 0, alreadyImported: 0, skippedPastEvent: 0, skippedNotLead: 0, failed: 0, backfilled: 0 };
  let formsCursor = state.formsCursor;
  let quoteCursor = state.quoteLeadsCursor;
  let sinceCheckpoint = 0;
  // items are processed oldest-first, so the cursor can advance item by item and be saved as we go
  const checkpoint = async (force = false) => {
    if (!force && ++sinceCheckpoint < 20) return;
    sinceCheckpoint = 0;
    await saveSyncState(orgId, { ...state, liveSince, formsCursor, quoteLeadsCursor: quoteCursor, lastRunAt: now.toISOString(), lastResult: r, lastError: null });
  };

  const ingest = async (payload: unknown, createdAt: string | null, defaultForm: "quote_builder" | "contact_us") => {
    const backfill = !createdAt || createdAt < liveSince;
    try {
      const out = await handleWixSubmission(payload, { backfill, keepSubmittedAt: true, defaultForm, now });
      if (out.outcome === "created") r.created++;
      else if (out.outcome === "attached" || out.outcome === "merged_blanks") r.attached++;
      else r.alreadyImported++;
      if (backfill && out.outcome === "created") r.backfilled++;
    } catch (e) {
      r.failed++;
      console.error("[wix-sync] ingest failed", (e as Error)?.message);
    }
  };

  try {
    // Wix Forms
    const forms = await client.listForms();
    const byId = new Map(forms.map((f) => [f.id, f]));
    const subs = await client.submissionsSince(since(formsCursor));
    for (const s of subs) {
      if (outOfTime()) {
        r.more = true;
        break;
      }
      r.checked++;
      await checkpoint();
      if (!formsCursor || s.createdDate > formsCursor) formsCursor = s.createdDate;
      const form = byId.get(s.formId);
      if (!form || !isLeadForm(form.name)) {
        r.skippedNotLead++;
        continue;
      }
      if (!shouldImport(submissionEventDate(s), s.createdDate, today, now)) {
        r.skippedPastEvent++;
        continue;
      }
      await ingest(formSubmissionToPayload(s, form.name, form.labels), s.createdDate, "contact_us");
    }

    // Quote Builder (QuoteLeads CMS collection)
    const quotes = r.more ? [] : await client.quoteLeadsSince(since(quoteCursor));
    for (const q of quotes) {
      if (outOfTime()) {
        r.more = true;
        break;
      }
      r.checked++;
      await checkpoint();
      const created = quoteLeadCreatedAt(q);
      const cmsCreated = typeof q._createdDate === "object" ? q._createdDate?.$date : q._createdDate;
      if (cmsCreated && (!quoteCursor || cmsCreated > quoteCursor)) quoteCursor = cmsCreated;
      const eventDate = q.eventDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
      if (!shouldImport(eventDate, created, today, now)) {
        r.skippedPastEvent++;
        continue;
      }
      await ingest(quoteLeadToPayload(q), created, "quote_builder");
    }

    await saveSyncState(orgId, { liveSince, formsCursor, quoteLeadsCursor: quoteCursor, lastRunAt: now.toISOString(), lastResult: r, lastError: null });
    return r;
  } catch (e) {
    // keep the cursors from before this run so nothing is skipped next time
    await saveSyncState(orgId, { ...state, liveSince, lastRunAt: now.toISOString(), lastResult: r, lastError: (e as Error)?.message ?? String(e) });
    throw e;
  }
}

/* -------------------------------------------------------------------------- */
/* Real client: Wix REST with a site API key                                  */
/* -------------------------------------------------------------------------- */

/**
 * Auth per Wix's REST docs ("API key admin"): `Authorization: <API key>` plus `wix-site-id`.
 * Endpoints: Forms "Query Forms", "Query Submissions By Namespace"; CMS "Query Data Items".
 */
export function wixRestClient(apiKey: string, siteId: string, fetcher: typeof fetch = fetch): WixClient {
  const post = async (path: string, body: unknown) => {
    const res = await fetcher(`https://www.wixapis.com${path}`, {
      method: "POST",
      headers: { Authorization: apiKey, "wix-site-id": siteId, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Wix ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<any>;
  };
  return {
    async listForms() {
      const out: { id: string; name: string; labels: Record<string, string> }[] = [];
      let cursor: string | undefined;
      do {
        const page = await post("/form-schema-service/v4/forms/query", {
          query: cursor ? { cursorPaging: { limit: 50, cursor } } : { filter: { namespace: { $eq: FORMS_NS } }, cursorPaging: { limit: 50 } },
        });
        for (const f of page.forms ?? []) {
          const labels: Record<string, string> = {};
          const walk = (o: any) => {
            if (!o || typeof o !== "object") return;
            if (Array.isArray(o)) return o.forEach(walk);
            if (typeof o.target === "string" && !labels[o.target]) {
              const m = JSON.stringify(o).match(/"label":"([^"]+)"/);
              if (m) labels[o.target] = m[1];
            }
            Object.values(o).forEach(walk);
          };
          walk(f.fields ?? []);
          walk(f.formFields ?? []);
          out.push({ id: f.id, name: f.name, labels });
        }
        cursor = page.metadata?.hasNext ? page.metadata.cursors?.next : undefined;
      } while (cursor);
      return out;
    },
    async submissionsSince(sinceIso) {
      const out: WixFormSubmission[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 50; i++) {
        const page = await post("/form-submission-service/v4/submissions/namespace/query", {
          query: cursor
            ? { cursorPaging: { limit: 100, cursor } }
            : {
                filter: { $and: [{ namespace: FORMS_NS }, { createdDate: { $gte: sinceIso } }] },
                sort: [{ fieldName: "createdDate", order: "ASC" }],
                cursorPaging: { limit: 100 },
              },
        });
        out.push(...(page.submissions ?? []));
        if (!page.metadata?.hasNext) break;
        cursor = page.metadata.cursors?.next;
      }
      return out;
    },
    async quoteLeadsSince(sinceIso) {
      const out: QuoteLeadItem[] = [];
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = await post("/wix-data/v2/items/query", {
          dataCollectionId: "QuoteLeads",
          query: {
            filter: { _createdDate: { $gte: { $date: sinceIso } } },
            sort: [{ fieldName: "_createdDate", order: "ASC" }],
            paging: { limit: 100, offset },
          },
        });
        const items = (page.dataItems ?? []).map((d: any) => ({ ...(d.data ?? {}), _id: d.data?._id ?? d.id }));
        out.push(...items);
        if (items.length < 100) break;
      }
      return out;
    },
  };
}
