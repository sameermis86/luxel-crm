"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mergeLeadsAction } from "./actions";

type Side = { id: string; recordId: string; created: string; status: string; readOnly: boolean; values: Record<string, string> };

export function MergeForm(props: { a: Side; b: Side; fields: { key: string; label: string }[]; defaults: Record<string, string>; defaultsReversed: Record<string, string> }) {
  const router = useRouter();
  const [keepA, setKeepA] = useState(true);
  const survivor = keepA ? props.a : props.b;
  const other = keepA ? props.b : props.a;
  const [choices, setChoices] = useState<Record<string, "survivor" | "merged">>(props.defaults as any);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const swap = () => {
    setKeepA(!keepA);
    setChoices((keepA ? props.defaultsReversed : props.defaults) as any);
  };
  const differing = props.fields.filter((f) => (props.a.values[f.key] ?? "") !== (props.b.values[f.key] ?? ""));
  const same = props.fields.length - differing.length;

  return (
    <div className="card overflow-x-auto p-4">
      {(props.a.readOnly || props.b.readOnly) && <p className="mb-3 text-sm text-bloom">One of these records is already merged or archived and can't be merged.</p>}
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-edge">
            <th className="th w-40">Field</th>
            <th className="th">
              <span className="chip border-stem bg-stem text-white">Keep</span> {survivor.recordId}
              <div className="text-[11px] font-normal normal-case text-muted">created {survivor.created} · {survivor.status.replace(/_/g, " ")}</div>
            </th>
            <th className="th">
              <span className="chip border-edge">Merge in</span> {other.recordId}
              <div className="text-[11px] font-normal normal-case text-muted">created {other.created} · {other.status.replace(/_/g, " ")}</div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {differing.map((f) => (
            <tr key={f.key}>
              <td className="td text-muted">{f.label}</td>
              {(["survivor", "merged"] as const).map((which) => {
                const v = (which === "survivor" ? survivor : other).values[f.key];
                return (
                  <td key={which} className="td">
                    <label className={`flex cursor-pointer items-start gap-2 rounded-md p-1 ${choices[f.key] === which ? "bg-stem-soft/70" : ""}`}>
                      <input type="radio" name={f.key} checked={choices[f.key] === which} onChange={() => setChoices((c) => ({ ...c, [f.key]: which }))} />
                      <span className={v ? "" : "text-muted italic"}>{v || "empty"}</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">{same} field{same === 1 ? " is" : "s are"} identical and not shown.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={swap}>Keep {other.recordId} instead</button>
        <button
          type="button"
          className="btn-bloom"
          disabled={pending || props.a.readOnly || props.b.readOnly}
          onClick={() =>
            start(async () => {
              const r = await mergeLeadsAction(survivor.id, other.id, choices);
              if (r.ok) router.push(`/leads/${survivor.id}?merged=1`);
              else setError(r.error);
            })
          }
        >
          {pending ? "Merging…" : `Merge ${other.recordId} into ${survivor.recordId}`}
        </button>
        {error && <span className="text-sm text-bloom">{error}</span>}
      </div>
    </div>
  );
}
