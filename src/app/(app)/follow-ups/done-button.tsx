"use client";

import { useTransition } from "react";
import { completeFollowUpAction } from "../leads/actions";

export function DoneButton({ followUpId, leadId }: { followUpId: string; leadId: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="btn py-0.5 text-xs" disabled={pending} onClick={() => start(() => completeFollowUpAction(followUpId, leadId))}>
      {pending ? "…" : "Done"}
    </button>
  );
}
