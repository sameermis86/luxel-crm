"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/** Email + password only (no email-link sign-in). "Forgot password?" sends a reset link. */
export function SupabaseLogin({ url, anonKey }: { url: string; anonKey: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = createBrowserClient(url, anonKey);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      // the same words whatever was wrong, so the form doesn't reveal who has an account
      return setMsg({ ok: false, text: /rate|too many/i.test(error.message) ? "Too many attempts. Wait a few minutes and try again." : "That email and password don't match." });
    }
    const r = await fetch("/api/auth/session-start", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) {
      setBusy(false);
      return setMsg({ ok: false, text: r?.error ?? "Couldn't sign in. Try again." });
    }
    window.location.href = r.next;
  }

  async function forgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/api/auth/callback?next=/account/password` });
    setBusy(false);
    setMsg({ ok: true, text: "If that email has an account, a link to set a new password is on its way. It works once and expires in an hour." });
  }

  return mode === "signin" ? (
    <form onSubmit={signIn} className="mt-8 space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className="label" htmlFor="password">Password</label>
          <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>
        </div>
        <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary h-10 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {msg && <p className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? "border-edge bg-card-2 text-ink/80" : "border-bloom/30 bg-bloom-soft text-bloom-strong"}`} role="status">{msg.text}</p>}
    </form>
  ) : (
    <form onSubmit={forgot} className="mt-8 space-y-4">
      <p className="text-sm text-muted">Enter your email and we&apos;ll send a link to set a new password.</p>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <button className="btn-primary h-10 w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
      <button type="button" className="btn-ghost w-full" onClick={() => { setMode("signin"); setMsg(null); }}>Back to sign in</button>
      {msg && <p className="rounded-lg border border-edge bg-card-2 px-3 py-2 text-sm text-ink/80" role="status">{msg.text}</p>}
    </form>
  );
}
