import { redirect } from "next/navigation";
import { NewLeadForm } from "./new-lead-form";
import { requireSession, can, homeFor } from "@/server/auth";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function NewLeadPage() {
  const session = await requireSession();
  if (!can(session, "leads:write")) redirect(homeFor(session));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Sales & CRM" title="New lead" description="For inquiries that don't come through the website: phone calls, Instagram DMs, walk-ins, wedding shows and referrals." />
      <NewLeadForm />
    </div>
  );
}
