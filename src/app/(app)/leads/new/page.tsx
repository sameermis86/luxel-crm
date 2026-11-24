import { NewLeadForm } from "./new-lead-form";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Sales & CRM" title="New lead" description="For inquiries that don't come through the website: phone calls, Instagram DMs, walk-ins, wedding shows and referrals." />
      <NewLeadForm />
    </div>
  );
}
