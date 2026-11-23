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
    <form onSubmit={signIn} className="mt-6 space-y-3">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password (leave blank for a magic link)</label>
        <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn-primary w-full py-2" disabled={busy}>{password ? "Sign in" : "Email me a link"}</button>
      {msg && <p className="text-sm text-muted">{msg}</p>}
    </form>
  );
}
