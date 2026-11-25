import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authMode, listDevUsers, DEV_COOKIE, getSession } from "@/server/auth";
import { SupabaseLogin } from "./supabase-login";
import { Logo } from "@/components/shell";

export const dynamic = "force-dynamic";

async function devLogin(formData: FormData) {
  "use server";
  if (authMode() !== "dev") throw new Error("dev login disabled");
  const id = String(formData.get("userId") ?? "");
  const users = await listDevUsers();
  if (!users.some((u) => u.id === id)) throw new Error("unknown user");
  (await cookies()).set(DEV_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/");
}

const REASONS: Record<string, string> = {
  expired: "You were signed out after a while without activity. Sign in again.",
  revoked: "Your session was ended (a password change or \"sign out everywhere\"). Sign in again.",
  signed_out_everywhere: "You've been signed out on every device.",
  signin: "Please sign in.",
  link: "That link has expired or was already used. Ask for a new one.",
  not_member: "This email isn't set up for the Luxel app. Ask an owner to add you.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const s = await getSession();
  if (s && !s.revoked) redirect(s.mfa === "needs_verify" ? "/login/verify" : "/");
  const reason = REASONS[(await searchParams).reason ?? ""];
  const mode = authMode();
  const users = mode === "dev" ? await listDevUsers() : [];
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* brand panel */}
      <section className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16" aria-hidden>
        <Botanical />
        <span className="relative inline-flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-white/10 ring-1 ring-white/15">
            <svg width="20" height="20" viewBox="0 0 32 32"><path d="M12 7.5v17h9.5" fill="none" stroke="#f5f3ee" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M12.2 15.2c2.6-3.6 6.4-4.4 8.6-3.6-.6 3.3-4.4 5.8-8.6 3.6Z" fill="#8aa890" /><circle cx="22.6" cy="24.5" r="2.3" fill="#bc5468" /></svg>
          </span>
          <span className="font-display text-xl tracking-[-0.02em]">Luxel</span>
        </span>
        <div className="relative max-w-md">
          <p className="eyebrow text-white/50">Luxel Decor &amp; Flowers · Vaughan</p>
          <h1 className="mt-4 text-[44px] leading-[1.05] xl:text-[52px]">Every inquiry, every event, every&nbsp;stem.</h1>
          <p className="mt-5 text-[15px] leading-relaxed text-white/65">
            One back office for the studio: leads from the website and Goodshuffle, pull sheets and teardown for signed events, and floral orders next.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2 text-xs text-white/70">
            {["Sales & CRM", "Fulfillment & Ops", "Floral orders"].map((d) => (
              <li key={d} className="rounded-full border border-white/15 px-3 py-1">{d}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* sign in */}
      <section className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-10 lg:hidden"><Logo /></div>
          <h2 className="text-[30px]">Welcome back</h2>
          <p className="mt-2 text-[15px] text-muted">Sign in to the studio back office.</p>
          {reason && <p className="mt-4 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-ink/80" role="status">{reason}</p>}
          {mode === "dev" ? (
            <form action={devLogin} className="mt-8 space-y-2.5">
              <p className="mb-3 text-sm text-muted">Local development: choose who you are.</p>
              {users.map((u) => (
                <button key={u.id} name="userId" value={u.id} className="btn h-12 w-full justify-start gap-3 px-3 text-left">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-stem-soft text-xs font-semibold text-stem-strong">{u.name.slice(0, 1)}</span>
                  <span className="flex-1">{u.name}</span>
                  <span className="text-xs font-normal text-muted capitalize">{u.role}</span>
                </button>
              ))}
              {!users.length && <p className="text-sm text-bloom">No users found. Run <code>pnpm db:seed</code>.</p>}
            </form>
          ) : (
            <SupabaseLogin url={process.env.NEXT_PUBLIC_SUPABASE_URL!} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!} />
          )}
          <p className="mt-10 text-xs text-faint">Access is limited to the Luxel team.</p>
        </div>
      </section>
    </main>
  );
}

/** Line drawing of cut stems: the brand's "cold storage + cut stem" world, drawn rather than photographed. */
function Botanical() {
  const leaf = (x: number, y: number, r: number, s = 1) => (
    <path key={`${x}-${y}`} d="M0 0c10-12 30-14 42-8-6 14-28 20-42 8Z" transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} fill="none" stroke="#8aa890" strokeWidth="1.3" />
  );
  return (
    <svg className="pointer-events-none absolute -right-24 bottom-0 h-[78%] w-auto opacity-90" viewBox="0 0 420 640" fill="none">
      <g stroke="#8aa890" strokeWidth="1.4" strokeLinecap="round" opacity="0.7">
        <path d="M210 640C206 520 196 400 222 250" />
        <path d="M150 640c6-120 24-210 -8-330" />
        <path d="M290 640c-10-110 0-180 46-262" />
      </g>
      <g opacity="0.75">
        {leaf(214, 420, -60)}
        {leaf(205, 520, 200, 0.9)}
        {leaf(150, 470, -120, 0.85)}
        {leaf(146, 380, 20, 0.8)}
        {leaf(300, 500, -40, 0.8)}
        {leaf(318, 430, 210, 0.75)}
      </g>
      {/* ranunculus */}
      <g transform="translate(222 232)" stroke="#bc5468" strokeWidth="1.3">
        {[44, 34, 25, 16, 8].map((r, i) => <circle key={r} r={r} opacity={0.35 + i * 0.13} />)}
      </g>
      <g transform="translate(142 300)" stroke="#f5f3ee" strokeWidth="1.1" opacity="0.55">
        {[22, 15, 8].map((r) => <circle key={r} r={r} />)}
      </g>
      <g transform="translate(336 372)" stroke="#bc5468" strokeWidth="1.1" opacity="0.6">
        {[18, 11, 5].map((r) => <circle key={r} r={r} />)}
      </g>
    </svg>
  );
}
