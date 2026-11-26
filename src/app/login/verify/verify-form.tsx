"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export function VerifyForm({ url, anonKey, next }: { url: string; anonKey: string; next: string }) {
  const supabase = createBrowserClient(url, anonKey);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trust, setTrust] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { data } = await supabase.auth.mfa.listFactors();
    const f = (data?.totp ?? []).find((x) => x.status === "verified");
    if (!f) { setBusy(false); return setErr("No authenticator is set up for this account."); }
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() });
    if (error) { setBusy(false); setCode(""); return setErr(/rate|too many/i.test(error.message) ? "Too many attempts. Wait a few minutes." : "That code didn't work. Try the newest one."); }
    if (trust) await fetch("/api/auth/trust-device", { method: "POST" }).catch(() => null);
    window.location.href = next;
  }
  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus
        placeholder="123456" className="input h-12 text-center font-mono text-xl tracking-[0.4em]" aria-label="6-digit code" />
      <label className="flex items-start gap-2 text-sm text-ink/80">
        <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} className="mt-0.5" />
        <span>Trust this device for 30 days<span className="block text-xs text-muted">Skip the code here; your password is still needed. Don&apos;t tick on a shared computer.</span></span>
      </label>
      <button className="btn-primary h-10 w-full" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Verify"}</button>
      {err && <p className="rounded-lg border border-bloom/30 bg-bloom-soft px-3 py-2 text-sm text-bloom-strong" role="alert">{err}</p>}
    </form>
  );
}
