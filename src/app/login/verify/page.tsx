import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Logo } from "@/components/shell";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Enter your code" };

/** Second step of sign-in: the 6-digit code from the authenticator app. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const s = await getSession();
  if (!s || s.revoked) redirect("/login");
  const nextParam = (await searchParams).next ?? "/";
  const next = /^\/(?!\/)[\w\-/?=&.]*$/.test(nextParam) ? nextParam : "/";
  if (s.mfa !== "needs_verify") redirect(next);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-8"><Logo /></div>
        <h1 className="text-[28px]">Enter your code</h1>
        <p className="mt-2 text-sm text-muted">Open your authenticator app and enter the 6-digit code for Luxel.</p>
        <VerifyForm url={process.env.NEXT_PUBLIC_SUPABASE_URL!} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!} next={next} />
        <form action="/api/auth/logout" method="post" className="mt-6"><button className="text-sm text-muted hover:text-ink">Use a different account</button></form>
      </div>
    </main>
  );
}
