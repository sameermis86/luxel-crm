"use client";

import { useState, useTransition } from "react";
import { undoImportAction } from "./actions";

export function UndoButton({ batchId }: { batchId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="btn py-0.5 text-xs"
        disabled={pending}
        onClick={() => {
          if (!confirm("Undo this import? Leads it created will be archived (kept read-only, not deleted) and blanks it filled will be cleared.")) return;
          start(async () => {
            const r = await undoImportAction(batchId);
            setMsg(r.ok ? `Archived ${r.data.archived}, reverted ${r.data.reverted}` : r.error);
          });
        }}
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </span>
  );
}
