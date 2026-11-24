"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addItemAction, addTaskAction, toggleItemAction, toggleTaskAction, itemNoteAction, removeItemAction } from "../../actions";

export interface PullItem {
  id: string;
  parentId: string | null;
  area: string;
  name: string;
  qty: number;
  logistics: boolean;
  fromGs: boolean;
  notes: string | null;
  pulled: string | null;
  loaded: string | null;
  returned: string | null;
}

export function PrintButton() {
  return <button type="button" className="btn" onClick={() => window.print()}>Print</button>;
}

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    const r = await fn();
    if (!r.ok) setErr(r.error ?? "Couldn't save");
    else {
      setErr(null);
      after?.();
      start(() => router.refresh());
    }
    return r;
  };
  return { act, pending, err };
}

/** Checkbox that flips at once and rolls back if the save fails. */
function Tick({ label, by, onChange, disabled }: { label: string; by: string | null; onChange: (on: boolean) => Promise<{ ok: boolean }>; disabled?: boolean }) {
  const [on, setOn] = useState(by !== null);
  useEffect(() => setOn(by !== null), [by]);
  return (
    <label className="flex cursor-pointer items-center justify-center gap-1" title={on ? `${label}${by ? ` by ${by}` : ""}` : `Mark ${label.toLowerCase()}`}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-[#5F8568]"
        checked={on}
        disabled={disabled}
        aria-label={label}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          const r = await onChange(next);
          if (!r.ok) setOn(!next);
        }}
      />
    </label>
  );
}

/** Pull sheet: Goodshuffle packages by area, the components the team adds under them, and pulled / loaded / returned ticks. */
export function PullSheet({ eventId, items, removed, printedSheet }: { eventId: string; items: PullItem[]; removed: string[]; printedSheet: string | null }) {
  const { act, pending, err } = useAct();
  const areas = [...new Set(items.filter((i) => !i.logistics).map((i) => i.area))];
  const logistics = items.filter((i) => i.logistics);
  const kids = (id: string) => items.filter((i) => i.parentId === id);
  const roots = (area: string) => items.filter((i) => i.area === area && !i.logistics && !i.parentId);

  const row = (i: PullItem, child = false) => (
    <tr key={i.id} className={child ? "bg-paper/40" : ""}>
      <td className={`td ${child ? "pl-8" : ""}`}>
        <div className={child ? "text-sm" : "font-medium"}>{child && <span className="mr-1 text-muted">↳</span>}{i.name}</div>
        <NoteField id={i.id} note={i.notes} act={act} />
      </td>
      <td className="td text-right tabular">{i.qty}</td>
      {(["pulled", "loaded", "returned"] as const).map((k) => (
        <td key={k} className="td text-center"><Tick label={k[0].toUpperCase() + k.slice(1)} by={i[k]} onChange={(on) => act(() => toggleItemAction(i.id, k, on))} /></td>
      ))}
      <td className="td text-right print:hidden">
        {!i.fromGs && <button type="button" className="text-xs text-muted hover:text-bloom" onClick={() => act(() => removeItemAction(i.id))}>Remove</button>}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted print:hidden">
        Lines come from Goodshuffle as packages. Add the pieces under each one so the team knows exactly what to pull.
        {printedSheet && <> Goodshuffle&apos;s own <a className="underline" href={printedSheet} target="_blank" rel="noreferrer">printed pull sheet ↗</a> has the component list if it&apos;s set up there.</>}
      </p>
      {err && <p className="text-sm text-bloom" role="alert">{err}</p>}
      {areas.length === 0 && <p className="card p-6 text-sm text-muted">No items on this project in Goodshuffle.</p>}
      {areas.map((area) => (
        <section key={area} className="card overflow-hidden break-inside-avoid">
          <h2 className="border-b border-edge bg-paper/50 px-4 py-2 text-lg">{area}</h2>
          <table className="w-full">
            <thead><tr><th className="th">Item</th><th className="th w-16 text-right">Qty</th><th className="th w-20 text-center">Pulled</th><th className="th w-20 text-center">Loaded</th><th className="th w-20 text-center">Returned</th><th className="th w-20 print:hidden" /></tr></thead>
            <tbody className="divide-y divide-edge">
              {roots(area).flatMap((i) => [row(i), ...kids(i.id).map((k) => row(k, true)), <AddRow key={`add-${i.id}`} eventId={eventId} parentId={i.id} area={area} label={`Add a piece to ${i.name}`} act={act} />])}
              <AddRow eventId={eventId} parentId={null} area={area} label={`Add another item to ${area}`} act={act} />
            </tbody>
          </table>
        </section>
      ))}
      {logistics.length > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="mb-1 text-lg">Logistics</h2>
          <ul className="list-disc pl-5">{logistics.map((l) => <li key={l.id}>{l.name}{l.qty !== 1 ? ` × ${l.qty}` : ""}</li>)}</ul>
        </section>
      )}
      {removed.length > 0 && <p className="text-xs text-muted">Removed in Goodshuffle since last sync: {removed.join(", ")}</p>}
    </div>
  );
}

type Act = ReturnType<typeof useAct>["act"];

function AddRow({ eventId, parentId, area, label, act }: { eventId: string; parentId: string | null; area: string; label: string; act: Act }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  if (!open)
    return (
      <tr className="print:hidden">
        <td colSpan={6} className={`px-3 py-1 ${parentId ? "pl-8" : ""}`}>
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setOpen(true)}>+ {label}</button>
        </td>
      </tr>
    );
  return (
    <tr className="print:hidden">
      <td colSpan={6} className={`px-3 py-2 ${parentId ? "pl-8" : ""}`}>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => addItemAction({ eventId, parentId, area, name, qty: Number(qty) }), () => { setName(""); setQty("1"); setOpen(false); });
          }}
        >
          <input autoFocus className="input w-72" placeholder="e.g. Gold chargers" value={name} onChange={(e) => setName(e.target.value)} aria-label="Item" required />
          <input className="input w-20 tabular" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantity" required />
          <button className="btn-primary">Add</button>
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        </form>
      </td>
    </tr>
  );
}

function NoteField({ id, note, act }: { id: string; note: string | null; act: Act }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(note ?? "");
  if (!edit)
    return note ? (
      <button type="button" className="text-left text-xs text-amber" onClick={() => setEdit(true)}>Note: {note}</button>
    ) : (
      <button type="button" className="text-xs text-muted opacity-0 hover:opacity-100 focus:opacity-100 print:hidden" onClick={() => setEdit(true)}>+ note</button>
    );
  return (
    <form className="mt-1 flex gap-2 print:hidden" onSubmit={(e) => { e.preventDefault(); act(() => itemNoteAction(id, v), () => setEdit(false)); }}>
      <input autoFocus className="input h-7 w-64 py-0 text-xs" value={v} onChange={(e) => setV(e.target.value)} placeholder="Damaged, short, substitute…" aria-label="Note" />
      <button className="btn h-7 py-0 text-xs">Save</button>
    </form>
  );
}

function TaskTick({ done, onChange }: { done: boolean; onChange: (on: boolean) => Promise<{ ok: boolean }> }) {
  const [on, setOn] = useState(done);
  useEffect(() => setOn(done), [done]);
  return (
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 accent-[#5F8568]"
      checked={on}
      onChange={async (e) => {
        const next = e.target.checked;
        setOn(next);
        if (!(await onChange(next)).ok) setOn(!next);
      }}
    />
  );
}

/** Setup / teardown checklist grouped by area; teardown also lists every item to count back in. */
export function Checklist({ eventId, phase, tasks, returns }: {
  eventId: string;
  phase: "setup" | "teardown";
  tasks: { id: string; area: string; title: string; done: string | null }[];
  returns: { id: string; area: string; name: string; qty: number; returned: string | null }[];
}) {
  const { act, pending, err } = useAct();
  const areas = [...new Set(tasks.map((t) => t.area))];
  const [title, setTitle] = useState("");
  const [area, setArea] = useState(areas[0] ?? "General");
  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-bloom" role="alert">{err}</p>}
      {areas.length === 0 && <p className="card p-6 text-sm text-muted">No {phase} tasks yet.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {areas.map((a) => (
          <section key={a} className="card break-inside-avoid p-4">
            <h2 className="mb-2 text-lg">{a}</h2>
            <ul className="space-y-1.5">
              {tasks.filter((t) => t.area === a).map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <TaskTick done={t.done !== null} onChange={(on) => act(() => toggleTaskAction(t.id, on))} />
                    <span className={t.done !== null ? "text-muted line-through" : ""}>{t.title}</span>
                    {t.done ? <span className="ml-auto shrink-0 text-xs text-muted">{t.done}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <form
        className="card flex flex-wrap items-end gap-2 p-3 print:hidden"
        onSubmit={(e) => { e.preventDefault(); act(() => addTaskAction({ eventId, phase, area, title }), () => setTitle("")); }}
      >
        <label className="block"><span className="label">Area</span>
          <input className="input w-48" list={`areas-${phase}`} value={area} onChange={(e) => setArea(e.target.value)} required />
          <datalist id={`areas-${phase}`}>{areas.map((a) => <option key={a} value={a} />)}</datalist>
        </label>
        <label className="block flex-1"><span className="label">Add a {phase} task</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={phase === "setup" ? "e.g. Steam the linens" : "e.g. Collect vases from the coat check"} required />
        </label>
        <button className="btn-primary">Add</button>
      </form>

      {phase === "teardown" && returns.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-edge bg-paper/50 px-4 py-2 text-lg">Count back in</h2>
          <table className="w-full">
            <thead><tr><th className="th">Item</th><th className="th">Area</th><th className="th w-16 text-right">Qty</th><th className="th w-24 text-center">Returned</th></tr></thead>
            <tbody className="divide-y divide-edge">
              {returns.map((r) => (
                <tr key={r.id}>
                  <td className="td">{r.name}</td>
                  <td className="td text-muted">{r.area}</td>
                  <td className="td text-right tabular">{r.qty}</td>
                  <td className="td text-center"><Tick label="Returned" by={r.returned} onChange={(on) => act(() => toggleItemAction(r.id, "returned", on))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
