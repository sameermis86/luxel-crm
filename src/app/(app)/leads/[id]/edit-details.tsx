"use client";

import { useActionState, useState } from "react";
import { EVENT_TYPES, SOURCES } from "@/db/schema";
import { fmtDate, fmtMoney, titleCase } from "@/lib/format";
import { updateLeadFieldsAction, type ActionResult } from "../actions";

type L = {
  id: string; firstName: string | null; lastName: string | null; partnerName: string | null; email: string | null; phone: string | null;
  eventType: string; eventDate: string | null; venueName: string | null; venueCity: string | null; guestCount: number | null;
  budgetMin: number | null; budgetMax: number | null; estimateTotal: number | null; tierInterest: string | null; services: string;
  message: string | null; quoteValue: number | null; source: string; sourceDetail: string | null;
};

export function EditDetails({ lead, readOnly }: { lead: L; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (p, fd) => {
    const r = await updateLeadFieldsAction(lead.id, p, fd);
    if (r.ok) setEditing(false);
    return r;
  }, null);

  if (!editing) {
    return (
      <section className="card p-4 text-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[17px]">Details</h2>
          {!readOnly && <button className="btn py-0.5 text-xs" onClick={() => setEditing(true)}>Edit</button>}
        </div>
        {state?.ok && <p className="mb-2 text-xs text-stem">{state.message}</p>}
        <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
          <dt className="text-muted">Email</dt><dd className="truncate">{lead.email ? <a className="underline" href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</dd>
          <dt className="text-muted">Phone</dt><dd>{lead.phone ? <a className="underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : "—"}</dd>
          <dt className="text-muted">Event</dt><dd>{titleCase(lead.eventType)} · {fmtDate(lead.eventDate)}</dd>
          <dt className="text-muted">Venue</dt><dd>{[lead.venueName, lead.venueCity].filter(Boolean).join(", ") || "—"}</dd>
          <dt className="text-muted">Guests</dt><dd>{lead.guestCount ?? "—"}</dd>
          <dt className="text-muted">Budget</dt>
          <dd>{lead.budgetMin != null || lead.budgetMax != null ? `${fmtMoney(lead.budgetMin)} – ${fmtMoney(lead.budgetMax)}` : "—"}</dd>
          {lead.estimateTotal != null && <><dt className="text-muted">Estimate</dt><dd>{fmtMoney(lead.estimateTotal)} (Quote Builder)</dd></>}
          <dt className="text-muted">Tier</dt><dd>{titleCase(lead.tierInterest)}</dd>
          <dt className="text-muted">Services</dt><dd>{lead.services ? titleCase(lead.services) : "—"}</dd>
        </dl>
        {lead.message && <p className="mt-3 border-t border-edge pt-2 whitespace-pre-wrap text-ink/80">“{lead.message}”</p>}
      </section>
    );
  }

  const F = ({ name, label, value, type = "text", span }: { name: keyof L | string; label: string; value: any; type?: string; span?: boolean }) => (
    <label className={`block ${span ? "col-span-2" : ""}`}>
      <span className="label">{label}</span>
      <input name={name as string} type={type} defaultValue={value ?? ""} className="input" />
    </label>
  );
  return (
    <form action={action} className="card grid grid-cols-2 gap-2 p-4 text-sm">
      <h2 className="col-span-2 text-[17px]">Edit details</h2>
      <F name="firstName" label="First name" value={lead.firstName} />
      <F name="lastName" label="Last name" value={lead.lastName} />
      <F name="partnerName" label="Partner" value={lead.partnerName} span />
      <F name="email" label="Email" value={lead.email} span />
      <F name="phone" label="Phone" value={lead.phone} span />
      <label className="block">
        <span className="label">Event type</span>
        <select name="eventType" defaultValue={lead.eventType} className="input">
          {EVENT_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </label>
      <F name="eventDate" label="Event date" value={lead.eventDate} type="date" />
      <F name="venueName" label="Venue" value={lead.venueName} />
      <F name="venueCity" label="City" value={lead.venueCity} />
      <F name="guestCount" label="Guests" value={lead.guestCount} />
      <label className="block">
        <span className="label">Tier</span>
        <select name="tierInterest" defaultValue={lead.tierInterest ?? ""} className="input">
          <option value="">—</option>
          {["effortless", "elegant", "elevated", "custom"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </label>
      <F name="budgetMin" label="Budget min" value={lead.budgetMin} />
      <F name="budgetMax" label="Budget max" value={lead.budgetMax} />
      <F name="services" label="Services (comma separated)" value={lead.services} span />
      <label className="block">
        <span className="label">Source</span>
        <select name="source" defaultValue={lead.source} className="input">
          {SOURCES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </label>
      <F name="sourceDetail" label="Source detail" value={lead.sourceDetail} />
      <F name="quoteValue" label="Quote" value={lead.quoteValue} />
      <label className="col-span-2 block">
        <span className="label">Message</span>
        <textarea name="message" defaultValue={lead.message ?? ""} rows={3} className="input" />
      </label>
      <div className="col-span-2 flex items-center gap-2">
        <button className="btn-primary" disabled={pending}>Save</button>
        <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        {state && !state.ok && <span className="text-bloom">{state.error}</span>}
      </div>
    </form>
  );
}
