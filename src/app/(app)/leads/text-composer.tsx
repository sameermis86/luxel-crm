"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Check, Mail, MessageSquareText } from "lucide-react";
import { renderEmail, renderSms, smsHref, type SmsLead } from "@/lib/sms";
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

/* ----------------------------- email ----------------------------- */

export interface EmailComposerLead { id: string; email: string; firstName: string | null; eventType: SmsLead["eventType"]; eventDate: string | null; venueName: string | null }

/** Reviewed reminder email: pick a template, edit, Send (from info@; nothing goes out without the click). */
export function EmailComposer({ lead, templates, senderName, signature, compact }: {
  lead: EmailComposerLead; templates: { label: string; subject: string; body: string }[]; senderName: string; signature: string; compact?: boolean;
}) {
  const router = useRouter();
  const fill = (i: number) => renderEmail(templates[i], lead, { senderName, signature, unsubscribeUrl: "" });
  const [t, setT] = useState(0);
  const [subject, setSubject] = useState(() => fill(0).subject);
  const [body, setBody] = useState(() => fill(0).body);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pick = (i: number) => { setT(i); const f = fill(i); setSubject(f.subject); setBody(f.body); };

  if (msg?.ok) return <p role="status" className="flex items-center gap-1.5 text-sm text-stem-strong"><Check size={15} aria-hidden /> {msg.text}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Email template">
        {templates.map((x, i) => (
          <button key={i} type="button" role="radio" aria-checked={t === i} onClick={() => pick(i)}
            className={`chip cursor-pointer ${t === i ? "border-ink bg-ink text-white" : "border-edge-strong bg-card text-ink/80 hover:border-ink/30"}`}>
            {x.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">To <span className="font-medium text-ink">{lead.email}</span> · from info@</p>
      <label className="block"><span className="sr-only">Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input text-[13px] font-medium" aria-label="Subject" />
      </label>
      <label className="block"><span className="sr-only">Email</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={compact ? 6 : 8} className="input text-[13px] leading-relaxed" aria-label="Email text" />
      </label>
      <p className="rounded-[var(--radius-control)] bg-card-2 px-3 py-2 text-xs whitespace-pre-line text-muted">
        {senderName}{"\n"}{signature}{"\n\n"}Don&apos;t want these emails? Unsubscribe: <span className="underline">link added automatically</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          className="btn-primary btn-sm"
          onClick={() => {
            if (!confirm(`Send this email to ${lead.email}?`)) return;
            start(async () => {
              const { sendReminderEmailAction } = await import("./actions");
              const r = await sendReminderEmailAction(lead.id, subject, body);
              setMsg(r.ok ? { ok: true, text: r.message ?? "Email sent" } : { ok: false, text: r.error });
              if (r.ok) router.refresh();
            });
          }}
        >
          <Mail size={13} strokeWidth={1.75} aria-hidden /> {pending ? "Sending…" : "Send email"}
        </button>
      </div>
      {msg && !msg.ok && <p role="alert" className="text-sm text-bloom">{msg.text}</p>}
    </div>
  );
}

/** Text | Email tabs over the two composers (only the channels this lead can get). */
export function ReminderComposer(props: {
  canText: boolean; canEmail: boolean; textLead: ComposerLead | null; emailLead: EmailComposerLead | null;
  sms: { templates: { label: string; body: string }[]; senderName: string };
  email: { templates: { label: string; subject: string; body: string }[]; signature: string };
  compact?: boolean;
}) {
  const [ch, setCh] = useState<"text" | "email">(props.canText ? "text" : "email");
  const both = props.canText && props.canEmail;
  return (
    <div className="space-y-2.5">
      {both && (
        <div className="seg" role="tablist" aria-label="Send by">
          {(["text", "email"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={ch === k} aria-current={ch === k ? "page" : undefined} onClick={() => setCh(k)} className="seg-item text-[13px]">
              {k === "text" ? "Text" : "Email"}
            </button>
          ))}
        </div>
      )}
      {ch === "text" && props.canText && props.textLead && <TextComposer compact={props.compact} lead={props.textLead} templates={props.sms.templates} senderName={props.sms.senderName} />}
      {ch === "email" && props.canEmail && props.emailLead && <EmailComposer compact={props.compact} lead={props.emailLead} templates={props.email.templates} senderName={props.sms.senderName} signature={props.email.signature} />}
    </div>
  );
}

/** "Unsubscribed from emails" toggle for the lead page. */
export function EmailOptOutToggle({ leadId, optedOut }: { leadId: string; optedOut: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={optedOut} disabled={pending} onChange={(e) => {
        const v = e.target.checked;
        if (!v && !confirm("Only allow emails again if they asked to hear from us. Continue?")) return;
        start(async () => {
          const { setEmailOptOutAction } = await import("./actions");
          const r = await setEmailOptOutAction(leadId, v);
          if (r.ok) router.refresh();
        });
      }} />
      Unsubscribed from emails
    </label>
  );
}
