"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { suggestMappingAction, previewImportAction, commitImportAction, type ImportPayload } from "./actions";
import type { Preview, CommitResult } from "@/server/import/csv";

type Opt = { value: string; label: string };

export function ImportWizard({ fields, presets, sources }: { fields: Opt[]; presets: { id: string; label: string }[]; sources: Opt[] }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [presetId, setPresetId] = useState<string | null>(null);
  const [defaultSource, setDefaultSource] = useState<string>("");
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "merge_blanks">("skip");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const payload = (): ImportPayload => ({
    fileName,
    rows,
    mapping: mapping as ImportPayload["mapping"],
    presetId,
    defaultSource: (defaultSource || null) as ImportPayload["defaultSource"],
    onDuplicate,
  });

  function onFile(file: File) {
    setError(null);
    setPreview(null);
    setResult(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter(Boolean);
        setHeaders(hs);
        setRows(res.data);
        start(async () => {
          const s = await suggestMappingAction(hs);
          setMapping(s.mapping);
          setPresetId(s.presetId);
        });
      },
      error: (e) => setError(e.message),
    });
  }

  const run = (kind: "preview" | "commit") =>
    start(async () => {
      setError(null);
      if (kind === "preview") {
        const r = await previewImportAction(payload());
        if (r.ok) setPreview(r.data);
        else setError(r.error);
      } else {
        const r = await commitImportAction(payload());
        if (r.ok) {
          setResult(r.data);
          setPreview(null);
        } else setError(r.error);
      }
    });

  const changed = () => {
    setPreview(null);
    setResult(null);
  };

  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="label">CSV file</span>
          <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {headers.length > 0 && (
          <>
            <label className="block">
              <span className="label">Preset</span>
              <select className="input" value={presetId ?? ""} onChange={(e) => { setPresetId(e.target.value || null); changed(); }}>
                <option value="">None (generic)</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Source when the file has none</span>
              <select className="input" value={defaultSource} onChange={(e) => { setDefaultSource(e.target.value); changed(); }}>
                <option value="">Other</option>
                {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <fieldset>
              <legend className="label">Duplicates</legend>
              <div className="flex gap-3 text-sm">
                <label className="flex items-center gap-1"><input type="radio" checked={onDuplicate === "skip"} onChange={() => { setOnDuplicate("skip"); changed(); }} /> Skip (default)</label>
                <label className="flex items-center gap-1"><input type="radio" checked={onDuplicate === "merge_blanks"} onChange={() => { setOnDuplicate("merge_blanks"); changed(); }} /> Merge into existing (fill blanks only)</label>
              </div>
            </fieldset>
          </>
        )}
      </div>

      {headers.length > 0 && (
        <div>
          <h3 className="mb-2 text-lg">Column mapping <span className="text-sm text-muted">· {rows.length} rows in {fileName}</span></h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {headers.map((h) => (
              <label key={h} className="flex items-center gap-2 rounded-md border border-edge p-2 text-sm">
                <span className="w-1/2 truncate" title={h}>
                  <span className="font-medium">{h}</span>
                  <span className="block truncate text-xs text-muted">{rows.find((r) => r[h])?.[h] ?? ""}</span>
                </span>
                <select
                  className="input w-1/2"
                  value={mapping[h] ?? "ignore"}
                  aria-label={`Map column ${h}`}
                  onChange={(e) => { setMapping((m) => ({ ...m, [h]: e.target.value })); changed(); }}
                >
                  {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-primary" disabled={pending || !rows.length} onClick={() => run("preview")}>{pending && !preview ? "Checking…" : "Preview"}</button>
            {preview && (
              <button className="btn-bloom" disabled={pending || preview.newCount + (onDuplicate === "merge_blanks" ? preview.duplicateCount : 0) === 0} onClick={() => run("commit")}>
                {pending ? "Importing…" : `Import ${preview.newCount} new${onDuplicate === "merge_blanks" ? ` + merge duplicates` : ""}`}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-bloom" role="alert">{error}</p>}

      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip border-stem/40 bg-stem-soft text-stem">{preview.newCount} new</span>
            <span className="chip border-amber/40 bg-amber-soft text-amber">{preview.duplicateCount} duplicates</span>
            <span className="chip border-bloom/40 bg-bloom-soft text-bloom">{preview.errorCount} errors</span>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-edge">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper">
                <tr><th className="th">Row</th><th className="th">Name</th><th className="th">Result</th><th className="th">Detail</th></tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {preview.rows.filter((r) => r.status !== "new").concat(preview.rows.filter((r) => r.status === "new")).map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="td tabular text-muted">{r.rowNumber}</td>
                    <td className="td">{r.name}</td>
                    <td className="td">
                      <span className={`chip ${r.status === "new" ? "border-stem/40 text-stem" : r.status === "error" ? "border-bloom/40 text-bloom" : "border-amber/40 text-amber"}`}>
                        {r.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="td text-muted">
                      {r.match ? (
                        <>Matches <Link className="underline" href={`/leads/${r.match.id}`} target="_blank">{r.match.recordId} {r.match.name}</Link> ({r.reasons.join(", ").replace(/_/g, " ")})</>
                      ) : r.reasons.join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-md border border-stem/40 bg-stem-soft/60 p-3 text-sm" role="status">
          Imported: <strong>{result.created}</strong> created, {result.merged} merged, {result.skipped} skipped, {result.errors.length} errors.{" "}
          <Link className="underline" href={`/leads?import_batch=${result.batchId}`}>View the imported leads</Link>
        </div>
      )}
    </section>
  );
}
