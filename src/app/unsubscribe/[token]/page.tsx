import { eq } from "drizzle-orm";
import { withCtx, systemCtx } from "@/db/client";
import { leads } from "@/db/schema";
import { readUnsubscribeToken } from "@/server/unsubscribe";
import { updateLead } from "@/server/leads/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe", robots: { index: false } };

/**
 * Public unsubscribe page linked from every reminder email. The link opens a confirm button (a POST),
 * so mail scanners that open links don't unsubscribe anyone by themselves.
 */
async function unsubscribe(formData: FormData) {
  "use server";
  const t = readUnsubscribeToken(String(formData.get("token") ?? ""));
  if (!t) return;
  const ctx = systemCtx(t.orgId);
  await withCtx(ctx, async (tx) => {
    const [l] = await tx.select({ id: leads.id, out: leads.emailOptOutAt }).from(leads).where(eq(leads.id, t.leadId));
    if (l && !l.out) await updateLead(tx, ctx, l.id, { emailOptOutAt: new Date() }, { allowReadOnly: true, payload: { via: "unsubscribe_link" } });
  });
  const { redirect } = await import("next/navigation");
  redirect(`/unsubscribe/${String(formData.get("token"))}?done=1`);
}

export default async function UnsubscribePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ done?: string }> }) {
  const { token } = await params;
  const { done } = await searchParams;
  const t = readUnsubscribeToken(token);
  let already = false;
  if (t) {
    const [l] = await withCtx(systemCtx(t.orgId), (tx) => tx.select({ out: leads.emailOptOutAt }).from(leads).where(eq(leads.id, t.leadId)));
    already = !!l?.out;
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper px-4">
      <div className="card w-full max-w-md p-7 text-center">
        <p className="eyebrow">Luxel Decor &amp; Flowers</p>
        {!t ? (
          <>
            <h1 className="mt-2 text-[26px]">This link isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted">To stop our emails, just reply to any of them and ask us to, and we&apos;ll take care of it.</p>
          </>
        ) : done || already ? (
          <>
            <h1 className="mt-2 text-[26px]">You&apos;re unsubscribed</h1>
            <p className="mt-2 text-sm text-muted">We won&apos;t send you any more reminder emails. If you ever want to hear from us again, just reply to one of our emails.</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-[26px]">Stop reminder emails?</h1>
            <p className="mt-2 text-sm text-muted">We&apos;ll stop sending you follow-up emails about your event.</p>
            <form action={unsubscribe} className="mt-5">
              <input type="hidden" name="token" value={token} />
              <button className="btn-primary">Unsubscribe</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
