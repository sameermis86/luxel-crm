"use client";

import { useActionState, useEffect, useState } from "react";
import type { Status } from "@/db/schema";
import { LOST_REASONS } from "@/db/schema";
import { LOST_REASON_LABELS } from "@/lib/status";
import { toLocalInput } from "@/lib/format";
import {
  logActivityAction,
  setFollowUpAction,
  changeStatusAction,
  reassignAction,
  type ActionResult,
} from "../actions";

type Panel = null | "call" | "email" | "meeting" | "note" | "follow_up" | "status" | "reassign";

export function QuickActions(props: {
  leadId: string;
  status: Status;
  allowed: { value: Status; label: string }[];
  users: { id: string; name: string }[];
  ownerId: string | null;
  suggestedFollowUp: string;
  quoteValue: number | null;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<string | null>(null); // suggested next follow-up after an activity

  const buttons: [Panel, string][] = [
    ["call", "Log call"],
    ["email", "Log email"],
    ["meeting", "Log meeting"],
    ["note", "Add note"],
    ["follow_up", "Set follow-up"],
    ["status", "Change status"],
    ["reassign", "Reassign"],
  ];

  return (
    <div className="mt-4 border-t border-edge pt-3">
      <div className="flex flex-wrap gap-2">
        {buttons.map(([k, label]) => (
          <button key={k} type="button" onClick={() => { setPanel(panel === k ? null : k); setPrompt(null); }} className={panel === k ? "btn-primary" : "btn"} aria-expanded={panel === k}>
            {label}
          </button>
        ))}
      </div>

      {prompt && panel === null && (
        <div className="mt-3 rounded-md border border-stem/40 bg-stem-soft/60 p-3 text-sm">
          <p className="mb-2 font-medium text-stem">Logged. When's the next follow-up?</p>
          <FollowUpForm leadId={props.leadId} defaultDue={prompt} users={props.users} ownerId={props.ownerId} onDone={() => setPrompt(null)} />
        </div>
      )}

      {(panel === "call" || panel === "email" || panel === "meeting" || panel === "note") && (
        <ActivityForm
          key={panel}
          leadId={props.leadId}
          kind={panel}
          onDone={(suggested) => {
            setPanel(null);
            if (suggested) setPrompt(suggested);
          }}
        />
      )}
      {panel === "follow_up" && (
        <div className="mt-3"><FollowUpForm leadId={props.leadId} defaultDue={props.suggestedFollowUp} users={props.users} ownerId={props.ownerId} onDone={() => setPanel(null)} /></div>
      )}
      {panel === "status" && <StatusForm {...props} onDone={() => setPanel(null)} />}
      {panel === "reassign" && <ReassignForm {...props} onDone={() => setPanel(null)} />}
    </div>
  );
}

function useFormAction(action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>, onOk: (r: ActionResult) => void) {
  const [state, run, pending] = useActionState<ActionResult | null, FormData>(action, null);
  useEffect(() => {
    if (state?.ok) onOk(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return { state, run, pending };
}

function Msg({ state }: { state: ActionResult | null }) {
  if (!state || state.ok) return null;
  return <p className="text-sm text-bloom" role="alert">{state.error}</p>;
}

function ActivityForm({ leadId, kind, onDone }: { leadId: string; kind: "call" | "email" | "meeting" | "note"; onDone: (suggested: string | null) => void }) {
  const { state, run, pending } = useFormAction(logActivityAction.bind(null, leadId), (r) =>
    onDone(r.ok && r.data?.suggestFollowUp ? toLocalInput(new Date(r.data.suggestedAt)) : null),
  );
  return (
    <form action={run} className="mt-3 grid gap-3 rounded-md border border-edge bg-paper/50 p-3 sm:grid-cols-4">
      <input type="hidden" name="kind" value={kind} />
      {kind !== "note" && (
        <>
          <label className="block">
            <span className="label">Direction</span>
            <select name="direction" className="input" defaultValue="outbound">
              <option value="outbound">We reached out</option>
              <option value="inbound">They reached us / replied</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Outcome</span>
            <select name="outcome" className="input" defaultValue="">
              <option value="">—</option>
              {kind === "call" && <><option>Connected</option><option>Left voicemail</option><option>No answer</option></>}
              {kind === "email" && <><option>Sent</option><option>Replied</option></>}
              {kind === "meeting" && <><option>Consult held</option><option>Site visit</option><option>No-show</option></>}
            </select>
          </label>
          <label className="block">
            <span className="label">When</span>
            <input type="datetime-local" name="occurredAt" className="input" />
          </label>
          <div />
        </>
      )}
      <label className="block sm:col-span-4">
        <span className="label">{kind === "note" ? "Note" : "Summary"}</span>
        <textarea name="summary" rows={3} className="input" autoFocus required={kind === "note"} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : kind === "note" ? "Add note" : `Log ${kind}`}</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

function FollowUpForm({ leadId, defaultDue, users, ownerId, onDone }: { leadId: string; defaultDue: string; users: { id: string; name: string }[]; ownerId: string | null; onDone: () => void }) {
  const { state, run, pending } = useFormAction(setFollowUpAction.bind(null, leadId), onDone);
  return (
    <form action={run} className="grid gap-3 rounded-md border border-edge bg-paper/50 p-3 sm:grid-cols-4">
      <label className="block">
        <span className="label">Due</span>
        <input type="datetime-local" name="dueAt" defaultValue={defaultDue} className="input" required />
      </label>
      <label className="block">
        <span className="label">Who</span>
        <select name="ownerId" className="input" defaultValue={ownerId ?? ""}>
          <option value="">Lead owner</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Note</span>
        <input name="note" className="input" placeholder="e.g. Send Elegant tier proposal" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button className="btn-primary" disabled={pending}>Set follow-up</button>
        <button type="button" className="btn-ghost" onClick={onDone}>Skip</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

function StatusForm(props: { leadId: string; allowed: { value: Status; label: string }[]; quoteValue: number | null; onDone: () => void }) {
  const [to, setTo] = useState<Status>(props.allowed[0]?.value ?? "contacted");
  const { state, run, pending } = useFormAction(changeStatusAction.bind(null, props.leadId), props.onDone);
  const closing = ["won", "lost", "unqualified"].includes(to);
  return (
    <form action={run} className="mt-3 grid gap-3 rounded-md border border-edge bg-paper/50 p-3 sm:grid-cols-4">
      <label className="block">
        <span className="label">Move to</span>
        <select name="status" className="input" value={to} onChange={(e) => setTo(e.target.value as Status)}>
          {props.allowed.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {to === "won" && (
        <label className="block">
          <span className="label">Quote value (optional)</span>
          <input name="quoteValue" className="input" inputMode="decimal" defaultValue={props.quoteValue ?? ""} />
        </label>
      )}
      {to === "proposal_sent" && (
        <label className="block">
          <span className="label">Quote value</span>
          <input name="quoteValue" className="input" inputMode="decimal" defaultValue={props.quoteValue ?? ""} />
        </label>
      )}
      {to === "consult_scheduled" && (
        <label className="block">
          <span className="label">Consult date/time</span>
          <input type="datetime-local" name="consultAt" className="input" />
        </label>
      )}
      {to === "lost" && (
        <>
          <label className="block">
            <span className="label">Reason (required)</span>
            <select name="lostReason" className="input" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {LOST_REASONS.map((r) => <option key={r} value={r}>{LOST_REASON_LABELS[r]}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Detail</span>
            <input name="lostReasonDetail" className="input" />
          </label>
        </>
      )}
      {to === "unqualified" && (
        <label className="block sm:col-span-3">
          <span className="label">Reason (required)</span>
          <input name="unqualifiedReason" className="input" required />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        {!closing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="setFollowUp" value="1" defaultChecked /> Set the default next follow-up
          </label>
        )}
        <button className="btn-primary" disabled={pending}>Change status</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

function ReassignForm(props: { leadId: string; users: { id: string; name: string }[]; ownerId: string | null; onDone: () => void }) {
  const { state, run, pending } = useFormAction(reassignAction.bind(null, props.leadId), props.onDone);
  return (
    <form action={run} className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-edge bg-paper/50 p-3">
      <label className="block">
        <span className="label">Owner</span>
        <select name="ownerId" className="input" defaultValue={props.ownerId ?? ""}>
          <option value="">Unassigned</option>
          {props.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <button className="btn-primary" disabled={pending}>Reassign</button>
      <Msg state={state} />
    </form>
  );
}

