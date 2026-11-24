import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { importBatches, users } from "@/db/schema";
import { withPage } from "@/server/page";
import { can } from "@/server/auth";
import { fmtDateTime, titleCase } from "@/lib/format";
import { IMPORT_FIELDS, PRESETS } from "@/lib/csv-import";
import { SOURCES } from "@/db/schema";
import { ImportWizard } from "./import-wizard";
import { UndoButton } from "./undo-button";
import { WixSyncPanel } from "./wix-sync-panel";
import { getSyncState } from "@/server/intake/wix-sync";
import { GoodshufflePanel } from "./goodshuffle-panel";
import { configuredCalendars, getGsState, getGsSettings } from "@/server/integrations/goodshuffle";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // "Sync now" can import a backlog

export default async function ImportsPage() {
  const { batches, page } = await withPage(async (tx) => ({
    batches: await tx
      .select({ b: importBatches, by: users.name })
      .from(importBatches)
      .leftJoin(users, eq(users.id, importBatches.createdBy))
      .orderBy(desc(importBatches.createdAt))
      .limit(50),
  }));
  if (!can(page.session, "imports:create")) redirect("/leads");
  const canUndo = can(page.session, "imports:undo");
  const sync = await getSyncState(page.session.orgId);
  const [gs, gsSettings] = await Promise.all([getGsState(page.session.orgId), getGsSettings(page.session.orgId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales & CRM"
        title="Import & sync"
        description="Leads arrive from Wix and Goodshuffle on their own; upload a CSV for anything else. Re-importing the same file creates nothing new."
      />

      <WixSyncPanel
        canRun={can(page.session, "imports:create")}
        status={{
          configured: !!(process.env.WIX_API_KEY && process.env.WIX_SITE_ID),
          lastRunAt: sync.lastRunAt ?? null,
          lastError: sync.lastError ?? null,
          lastResult: (sync.lastResult as unknown as Record<string, number>) ?? null,
          liveSince: sync.liveSince ?? null,
        }}
      />

      <GoodshufflePanel
        isOwner={can(page.session, "settings:manage")}
        data={{
          configured: Object.keys(configuredCalendars()),
          autoApply: gsSettings.autoApply,
          lastRunAt: gs.lastRunAt ?? null,
          mode: gs.mode ?? null,
          events: gs.events ?? 0,
          alreadyInStep: gs.alreadyInStep ?? 0,
          lastError: gs.lastError ?? null,
          changes: gs.changes ?? [],
          unmatched: gs.unmatched ?? [],
        }}
      />

      <ImportWizard
        fields={Object.entries(IMPORT_FIELDS).map(([value, label]) => ({ value, label }))}
        presets={Object.values(PRESETS).map((p) => ({ id: p.id, label: p.label }))}
        sources={SOURCES.map((s) => ({ value: s, label: titleCase(s) }))}
      />

      <section className="card overflow-x-auto">
        <h2 className="border-b border-edge px-4 py-3 text-xl">Past imports</h2>
        <table className="w-full min-w-[760px]">
          <thead className="bg-paper/60">
            <tr>
              <th className="th">When</th>
              <th className="th">File</th>
              <th className="th">By</th>
              <th className="th text-right">Rows</th>
              <th className="th text-right">Created</th>
              <th className="th text-right">Merged</th>
              <th className="th text-right">Skipped</th>
              <th className="th text-right">Errors</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {batches.length === 0 && (
              <tr><td colSpan={9} className="td py-6 text-center text-muted">No imports yet.</td></tr>
            )}
            {batches.map(({ b, by }) => (
              <tr key={b.id} className={b.undoneAt ? "text-muted" : ""}>
                <td className="td whitespace-nowrap">{fmtDateTime(b.createdAt)}</td>
                <td className="td">{b.fileName}{b.preset && <span className="chip ml-2 border-edge">{PRESETS[b.preset]?.label ?? b.preset}</span>}</td>
                <td className="td">{by ?? "—"}</td>
                <td className="td text-right tabular">{b.rowCount}</td>
                <td className="td text-right tabular">
                  {b.created > 0 ? <Link className="underline" href={`/leads?import_batch=${b.id}${b.undoneAt ? "&include_archived=1" : ""}`}>{b.created}</Link> : 0}
                </td>
                <td className="td text-right tabular">{b.merged}</td>
                <td className="td text-right tabular">{b.duplicatesSkipped}</td>
                <td className="td text-right tabular">
                  {(b.errors as any[]).length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-bloom">{(b.errors as any[]).length}</summary>
                      <ul className="mt-1 text-left text-xs">
                        {(b.errors as { row: number; reason: string }[]).slice(0, 20).map((e) => <li key={e.row}>Row {e.row}: {e.reason}</li>)}
                      </ul>
                    </details>
                  ) : 0}
                </td>
                <td className="td text-right">
                  {b.undoneAt ? <span className="text-xs">Undone {fmtDateTime(b.undoneAt)}</span> : canUndo && (b.created > 0 || b.merged > 0) ? <UndoButton batchId={b.id} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
