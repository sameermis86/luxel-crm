"use client";
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export function SupabaseLogin({ url, anonKey }: { url: string; anonKey: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supabase = createBrowserClient(url, anonKey);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = password
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` } });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (password) window.location.href = "/";
    else setMsg("Check your email for a sign-in link.");
  }

  return (
    <form onSubmit={signIn} className="mt-8 space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="hint">Leave blank and we&apos;ll email you a sign-in link.</p>
      </div>
      <button className="btn-primary h-10 w-full" disabled={busy}>{busy ? "Signing in…" : password ? "Sign in" : "Email me a sign-in link"}</button>
      {msg && <p className="rounded-lg border border-edge bg-card-2 px-3 py-2 text-sm text-ink/80" role="status">{msg}</p>}
    </form>
  );
}
