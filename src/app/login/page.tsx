import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authMode, listDevUsers, DEV_COOKIE, getSession } from "@/server/auth";
import { SupabaseLogin } from "./supabase-login";

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

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const mode = authMode();
  const users = mode === "dev" ? await listDevUsers() : [];
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">Luxel Decor &amp; Flowers</p>
        <h1 className="mt-1 text-3xl">Lead desk</h1>
        {mode === "dev" ? (
          <form action={devLogin} className="mt-6 space-y-3">
            <p className="text-sm text-muted">Local development login. Pick who you are:</p>
            {users.map((u) => (
              <button key={u.id} name="userId" value={u.id} className="btn w-full justify-between py-2">
                <span>{u.name}</span>
                <span className="text-xs text-muted">{u.role}</span>
              </button>
            ))}
            {!users.length && <p className="text-sm text-bloom">No users found. Run <code>pnpm db:seed</code>.</p>}
          </form>
        ) : (
          <SupabaseLogin url={process.env.NEXT_PUBLIC_SUPABASE_URL!} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!} />
        )}
      </div>
    </main>
  );
}
