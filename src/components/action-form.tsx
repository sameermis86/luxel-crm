"use client";

import { useActionState, useTransition, useState } from "react";

type R = { ok: true; message: string } | { ok: false; error: string };

/** A form bound to a server action, with a submit button and an inline result line. */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  className = "",
}: {
  action: (prev: R | null, fd: FormData) => Promise<R>;
  children: React.ReactNode;
  submitLabel?: string;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className}>
      {children}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
        {state && <span className={`text-sm ${state.ok ? "text-stem" : "text-bloom"}`} role="status">{state.ok ? state.message : state.error}</span>}
      </div>
    </form>
  );
}

/** A button that runs a no-argument server action, with confirmation and an inline result. */
export function ActionButton({ action, label, confirmText, className = "btn" }: { action: () => Promise<R>; label: string; confirmText?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<R | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          start(async () => setMsg(await action()));
        }}
      >
        {pending ? "Working…" : label}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? "text-stem" : "text-bloom"}`}>{msg.ok ? msg.message : msg.error}</span>}
    </span>
  );
}
