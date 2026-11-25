"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { inviteMemberAction } from "./actions";

export function InviteButton({ userId, signedIn }: { userId: string; signedIn: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="flex flex-wrap items-center justify-end gap-2">
      {msg && <span role="status" className={`text-xs ${msg.ok ? "text-stem-strong" : "text-bloom"}`}>{msg.text}</span>}
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => start(async () => {
        const r = await inviteMemberAction(userId);
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      })}>
        <Send size={13} strokeWidth={1.75} aria-hidden /> {pending ? "Sending…" : signedIn ? "Send password reset" : "Send invite"}
      </button>
    </span>
  );
}
