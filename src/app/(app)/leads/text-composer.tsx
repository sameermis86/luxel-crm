"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, MessageSquareText } from "lucide-react";
import { renderSms, smsHref, type SmsLead } from "@/lib/sms";
import { logTextAction } from "./actions";

export interface ComposerLead extends Omit<SmsLead, "createdAt" | "smsOptOutAt"> {
  id: string;
  phoneE164: string;
}

/**
 * One-tap SMS from the office iPhone: pick a template, adjust it, "Open in Messages" fills the text
 * in the phone's Messages app (sms: link); after sending there, "Mark as sent" logs it on the lead.
 */
export function TextComposer({ lead, templates, senderName, compact }: { lead: ComposerLead; templates: { label: string; body: string }[]; senderName: string; compact?: boolean }) {
  const router = useRouter();
  const [t, setT] = useState(0);
  const initial = useMemo(() => renderSms(templates[0]?.body ?? "", { ...lead, createdAt: new Date(), smsOptOutAt: null }, { senderName }), [lead, templates, senderName]);
  const [text, setText] = useState(initial);
  const [opened, setOpened] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = (i: number) => {
    setT(i);
    setText(renderSms(templates[i].body, { ...lead, createdAt: new Date(), smsOptOutAt: null }, { senderName }));
    setOpened(false);
  };

  if (msg?.ok) return <p role="status" className="flex items-center gap-1.5 text-sm text-stem-strong"><Check size={15} aria-hidden /> {msg.text}</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Message template">
        {templates.map((x, i) => (
          <button key={i} type="button" role="radio" aria-checked={t === i} onClick={() => pick(i)}
            className={`chip cursor-pointer ${t === i ? "border-ink bg-ink text-white" : "border-edge-strong bg-card text-ink/80 hover:border-ink/30"}`}>
            {x.label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="sr-only">Message</span>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setOpened(false); }} rows={compact ? 4 : 5} className="input text-[13px] leading-relaxed" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <a href={smsHref(lead.phoneE164, text)} onClick={() => setOpened(true)} className={opened ? "btn btn-sm" : "btn-primary btn-sm"}>
          <MessageSquareText size={13} strokeWidth={1.75} aria-hidden /> Open in Messages
        </a>
        <button
          type="button"
          disabled={pending}
          className={opened ? "btn-primary btn-sm" : "btn btn-sm"}
          onClick={() =>
            start(async () => {
              const r = await logTextAction(lead.id, text);
              setMsg(r.ok ? { ok: true, text: "Text logged on the lead" } : { ok: false, text: r.error });
              if (r.ok) router.refresh();
            })
          }
        >
          <Check size={13} strokeWidth={1.75} aria-hidden /> {pending ? "Logging…" : "Mark as sent"}
        </button>
        <span className="text-xs text-muted tabular">{text.length} chars{text.length > 160 ? ` · ${Math.ceil(text.length / 153)} texts` : ""}</span>
      </div>
      {opened && <p className="hint">Sent it in Messages? Tap <strong className="font-medium text-ink">Mark as sent</strong> so the lead shows it.</p>}
      {msg && !msg.ok && <p role="alert" className="text-sm text-bloom">{msg.text}</p>}
    </div>
  );
}

/** "They replied STOP": no more texts (shown on the lead page). */
export function SmsOptOutToggle({ leadId, optedOut }: { leadId: string; optedOut: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={optedOut}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          if (!v && !confirm("Only allow texts again if they asked to be texted. Continue?")) return;
          start(async () => {
            const { setSmsOptOutAction } = await import("./actions");
            const r = await setSmsOptOutAction(leadId, v);
            if (r.ok) router.refresh();
            else setErr(r.error);
          });
        }}
      />
      They asked not to be texted (replied STOP)
      {err && <span className="text-xs text-bloom">{err}</span>}
    </label>
  );
}
