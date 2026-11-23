import { NewLeadForm } from "./new-lead-form";

export const dynamic = "force-dynamic";

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl">New lead</h1>
        <p className="mt-1 text-sm text-muted">Phone calls, Instagram DMs, walk-ins, wedding shows and referrals.</p>
      </div>
      <NewLeadForm />
    </div>
  );
}
