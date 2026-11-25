"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { recordMfaChangeAction } from "./actions";

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };

/** Enrol / remove an authenticator (TOTP) with Supabase, then log the change on the server. */
export function TwoStep({ required }: { required: boolean }) {
  const router = useRouter();
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(((data?.totp ?? []) as Factor[]).filter((f) => f.status === "verified"));
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = () => start(async () => {
    setMsg(null);
    // clear half-finished attempts first
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of (all?.all ?? []).filter((f) => f.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toLocaleDateString("en-CA")}` });
    if (error || !data) return setMsg({ ok: false, text: error?.message ?? "Couldn't start" });
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  });

  const confirm = () => start(async () => {
    if (!enrol) return;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.id, code: code.trim() });
    if (error) return setMsg({ ok: false, text: "That code didn't work. Check the time on your phone and try the newest code." });
    await recordMfaChangeAction();
    setEnrol(null);
    setCode("");
    setMsg({ ok: true, text: "2-step verification is on. You'll be asked for a code when you sign in." });
    await load();
    router.refresh();
  });

  const remove = (id: string) => start(async () => {
    if (!confirm_(required ? "Your access requires 2-step. Remove this authenticator only if you're adding another one." : "Turn off 2-step verification?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return setMsg({ ok: false, text: error.message });
    await supabase.auth.refreshSession();
    await recordMfaChangeAction();
    await load();
    router.refresh();
  });

  if (factors === null) return <p className="mt-3 text-sm text-muted">Loading…</p>;
  return (
    <div className="mt-3 space-y-3">
      {factors.length > 0 ? (
        <ul className="space-y-1.5">
          {factors.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-edge px-3 py-2 text-sm">
              <span><span className="chip mr-2 border-stem/25 bg-stem-soft text-stem-strong">On</span>{f.friendly_name || "Authenticator app"}</span>
              <button type="button" className="btn-ghost btn-sm text-bloom-strong" disabled={pending} onClick={() => remove(f.id)}>Remove</button>
            </li>
          ))}
        </ul>
      ) : !enrol ? (
        <button type="button" className="btn-primary" disabled={pending} onClick={begin}>{pending ? "Starting…" : "Set up 2-step verification"}</button>
      ) : null}

      {enrol && (
        <div className="grid gap-4 rounded-[var(--radius-card)] border border-edge bg-card-2 p-4 sm:grid-cols-[180px_1fr]">
          {/* Supabase returns the QR code as an SVG data URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrol.qr} alt="QR code to scan with your authenticator app" width={180} height={180} className="rounded-md bg-white p-2" />
          <div className="space-y-2 text-sm">
            <p>1. Scan this with your authenticator app. Can&apos;t scan? Enter this key: <code className="rounded bg-card px-1 font-mono text-xs break-all">{enrol.secret}</code></p>
            <p>2. Enter the 6-digit code it shows.</p>
            <div className="flex flex-wrap gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="input w-32 font-mono tracking-widest" aria-label="6-digit code" />
              <button type="button" className="btn-primary" disabled={pending || code.length !== 6} onClick={confirm}>{pending ? "Checking…" : "Turn on"}</button>
            </div>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-stem-strong" : "text-bloom"}`}>{msg.text}</p>}
    </div>
  );
}
const confirm_ = (t: string) => window.confirm(t);
