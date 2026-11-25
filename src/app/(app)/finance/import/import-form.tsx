"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { FINANCE_FIELDS, guessMapping, mapFinanceRow, type FinanceField, type FinanceMapping } from "@/lib/finance";
import { importFinanceAction } from "../actions";

const money = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD" }));

/** Upload a Goodshuffle export, check the columns, preview, import. */
export function FinanceImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null);
  const [mapping, setMapping] = useState<FinanceMapping>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [replace, setReplace] = useState(false);

  const onFile = async (f: File | undefined) => {
    setMsg(null);
    if (!f) return;
    // Goodshuffle exports Windows-1252 (e.g. non-breaking spaces in amounts); read as UTF-8 only if it is
    const buf = await f.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder("windows-1252").decode(buf);
    }
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const headers = (res.meta.fields ?? []).filter(Boolean);
        if (!headers.length || !res.data.length) return setMsg({ ok: false, text: "That file has no rows. Export it from Goodshuffle as CSV." });
        setFile({ name: f.name, headers, rows: (res.data as Record<string, string>[]).slice(0, 5000) });
        setMapping(guessMapping(headers));
      },
      error: () => setMsg({ ok: false, text: "Couldn't read that file. Export it from Goodshuffle as CSV." }),
    });
  };
  const preview = file ? file.rows.map((r) => mapFinanceRow(r, mapping)).filter((r) => r.ok || !r.notContract).slice(0, 6) : [];
  const mapped = file ? file.rows.map((r) => mapFinanceRow(r, mapping)) : [];
  const valid = mapped.filter((r) => r.ok).length;
  const notContracts = mapped.filter((r) => !r.ok && r.notContract).length;
  const unreadable = mapped.length - valid - notContracts;

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <label className="block max-w-md">
          <span className="label">Goodshuffle export (CSV)</span>
          <input type="file" accept=".csv,text/csv" className="input" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <p className="hint">One row per project, with the project number and the contract total (paid and balance if the report has them). Importing the same projects again updates them.</p>
      </section>

      {file && (
        <section className="card space-y-4 p-5">
          <h2 className="text-[17px]">Columns in {file.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(FINANCE_FIELDS) as FinanceField[]).map((f) => (
              <label key={f} className="block">
                <span className="label">{FINANCE_FIELDS[f].label}{FINANCE_FIELDS[f].required ? " *" : ""}</span>
                <select className="input" value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))}>
                  <option value="">Not in this file</option>
                  {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto rounded-[var(--radius-control)] border border-edge">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-card-2"><tr><th className="th">Project</th><th className="th">Client</th><th className="th">Event</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th text-right">Balance</th></tr></thead>
              <tbody className="divide-y divide-edge">
                {preview.map((p, i) => p.ok ? (
                  <tr key={i}><td className="td font-mono text-xs">{p.row.project}</td><td className="td">{p.row.client ?? "—"}</td><td className="td tabular">{p.row.eventDate ?? "—"}</td><td className="td text-right tabular">{money(p.row.total)}</td><td className="td text-right tabular">{money(p.row.paid)}</td><td className="td text-right tabular">{money(p.row.balance)}</td></tr>
                ) : (
                  <tr key={i}><td colSpan={6} className="td text-bloom">{p.error}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-start gap-2 rounded-[var(--radius-control)] border border-edge bg-card-2 px-3 py-2 text-sm">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="mt-0.5" />
            <span><span className="font-medium">Replace everything imported before</span><span className="block text-xs text-muted">This file becomes the full list: contracts not in it are removed. Leave unticked to add and update only.</span></span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !mapping.project || !mapping.total || valid === 0}
              onClick={() => start(async () => {
                if (replace && !confirm(`Replace all previously imported contracts with the ${valid} in this file?`)) return;
                const r = await importFinanceAction({ filename: file.name, mapping: mapping as Record<string, string>, rows: file.rows, replace });
                setMsg(r.ok ? { ok: true, text: r.message, errors: r.data.errors } : { ok: false, text: r.error });
                if (r.ok) router.refresh();
              })}
            >
              {pending ? "Importing…" : `${replace ? "Replace with" : "Import"} ${valid} contract${valid === 1 ? "" : "s"}`}
            </button>
            <span className="text-sm text-muted">
              {notContracts > 0 && `${notContracts} quote/lost project${notContracts === 1 ? "" : "s"} left out (not signed contracts). `}
              {unreadable > 0 ? `${unreadable} row(s) can't be read and will be skipped.` : notContracts ? "" : "All rows look good."}
            </span>
          </div>
        </section>
      )}

      {msg && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? "border-stem/25 bg-stem-soft text-stem-strong" : "border-bloom/30 bg-bloom-soft text-bloom-strong"}`}>
          {msg.text}
          {msg.ok && <> · <Link href="/finance" className="underline">See the overview</Link></>}
          {msg.errors && msg.errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-ink/70">{msg.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
