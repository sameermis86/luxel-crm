"use client";

import { useActionState } from "react";
import { saveCampaignAction } from "./actions";

type Init = { id: string; name: string; channel: string; utmCampaign: string; startDate: string; endDate: string; spend: string; reviewed: boolean };

export function CampaignForm({ channels, initial }: { channels: { value: string; label: string }[]; initial?: Init }) {
  const [state, action, pending] = useActionState(saveCampaignAction, null);
  const id = initial?.id ?? "new";
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-2 text-sm md:grid-cols-4 xl:grid-cols-8">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <label className="col-span-2 block">
        <span className="label">Name</span>
        <input name="name" defaultValue={initial?.name} required className="input" />
      </label>
      <label className="block">
        <span className="label">Channel</span>
        <select name="channel" defaultValue={initial?.channel ?? "google_ads"} className="input">
          {channels.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">utm_campaign key</span>
        <input name="utmCampaign" defaultValue={initial?.utmCampaign} className="input" placeholder="spring-bridal-2027" />
      </label>
      <label className="block">
        <span className="label">Start</span>
        <input type="date" name="startDate" defaultValue={initial?.startDate} className="input" />
      </label>
      <label className="block">
        <span className="label">End</span>
        <input type="date" name="endDate" defaultValue={initial?.endDate} className="input" />
      </label>
      <label className="block">
        <span className="label">Spend (CAD)</span>
        <input name="spend" defaultValue={initial?.spend} inputMode="decimal" className="input" />
      </label>
      <div className="flex items-center gap-2 pb-1">
        <label className="flex items-center gap-1" htmlFor={`rev-${id}`}>
          <input id={`rev-${id}`} type="checkbox" name="reviewed" defaultChecked={initial ? initial.reviewed : true} /> Reviewed
        </label>
        <button className="btn-primary" disabled={pending}>{initial ? "Save" : "Add"}</button>
      </div>
      {state && <p className={`col-span-full text-xs ${state.ok ? "text-stem" : "text-bloom"}`}>{state.ok ? state.message : state.error}</p>}
    </form>
  );
}
