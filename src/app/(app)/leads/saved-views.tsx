"use client";

import { useActionState } from "react";
import { saveViewAction, deleteViewAction, type ActionResult } from "./actions";

export function SaveViewForm({ query }: { query: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveViewAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="query" value={query} />
      <label htmlFor="view-name" className="sr-only">View name</label>
      <input id="view-name" name="name" placeholder="Save this view as…" className="input w-52" />
      <button className="btn" disabled={pending}>Save view</button>
      {state && <span className={state.ok ? "text-stem" : "text-bloom"}>{state.ok ? state.message : state.error}</span>}
    </form>
  );
}

export function DeleteViewButton({ id }: { id: string }) {
  return (
    <button type="button" aria-label="Delete view" className="text-muted hover:text-bloom" onClick={() => deleteViewAction(id)}>
      ×
    </button>
  );
}
