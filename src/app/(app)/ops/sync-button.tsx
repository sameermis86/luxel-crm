"use client";
import { useState, useTransition } from "react";
import { syncOpsNowAction } from "./actions";

export function SyncOpsButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted" role="status">{msg}</span>}
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncOpsNowAction();
            setMsg(r.ok ? `${r.data!.projects} signed events, ${r.data!.created} new` : r.error);
          })
        }
      >
        {pending ? "Syncing…" : "Sync from Goodshuffle"}
      </button>
    </span>
  );
}
