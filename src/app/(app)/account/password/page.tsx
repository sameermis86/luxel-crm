import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { arrivedByLink } from "@/server/auth-link";
import { PASSWORD_MIN } from "@/lib/password";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/action-form";
import { changePasswordAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password" };

/** Where invite and reset emails land: set a password (no current password needed for 30 minutes). */
export default async function SetPasswordPage() {
  const s = await requireSession({ allowPendingMfa: true });
  if (s.mfa === "needs_verify") redirect("/login/verify?next=/account/password");
  const byLink = await arrivedByLink();
  return (
    <div className="max-w-md space-y-5">
      <PageHeader
        eyebrow="Account"
        title={byLink ? "Welcome: set your password" : "Change your password"}
        description={`For ${s.email}. At least ${PASSWORD_MIN} characters with letters and numbers; not your name, email or "Luxel". You'll use it to sign in from now on.`}
      />
      <ActionForm action={changePasswordAction} submitLabel="Save password" className="card grid gap-3 p-5">
        {!byLink && <label className="block"><span className="label">Current password</span><input name="current" type="password" autoComplete="current-password" className="input" /></label>}
        <label className="block"><span className="label">New password</span><input name="next" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required className="input" /></label>
        <label className="block"><span className="label">New password again</span><input name="confirm" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required className="input" /></label>
      </ActionForm>
      <p className="text-sm text-muted">Next: <a href="/account" className="underline">set up 2-step verification</a> if your access needs it.</p>
    </div>
  );
}
