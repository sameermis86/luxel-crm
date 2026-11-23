"use client";

import { useEffect, useTransition } from "react";
import { completeFollowUpAction, dismissDuplicateAction, markNotificationRead } from "../actions";

export function CompleteFollowUpButton({ followUpId, leadId }: { followUpId: string; leadId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn py-0.5 text-xs" disabled={pending} onClick={() => start(() => completeFollowUpAction(followUpId, leadId))}>
      {pending ? "…" : "Done"}
    </button>
  );
}

export function DismissDuplicateButton({ candidateId, leadId }: { candidateId: string; leadId: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-ghost py-0.5 text-xs" disabled={pending} onClick={() => start(() => dismissDuplicateAction(candidateId, leadId))}>
      Not a duplicate
    </button>
  );
}

export function MarkSeen({ id }: { id: string }) {
  useEffect(() => {
    void markNotificationRead(id);
  }, [id]);
  return null;
}
