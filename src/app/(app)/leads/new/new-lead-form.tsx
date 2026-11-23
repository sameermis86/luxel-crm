"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeadAction, checkDuplicatesAction, type ActionResult } from "../actions";
import { fmtDate, titleCase } from "@/lib/format";
import { MATCH_REASON_LABELS, type MatchReason } from "@/lib/duplicates";

type Match = Awaited<ReturnType<typeof checkDuplicatesAction>>[number];

const SOURCES: [string, string][] = [
  ["phone", "Phone call"],
  ["instagram", "Instagram DM"],
  ["facebook", "Facebook"],
  ["walk_in", "Walk-in"],
  ["wedding_show", "Wedding show"],
  ["referral", "Referral"],
  ["venue_partner", "Venue partner"],
  ["email", "Email"],
  ["google_business_profile", "Google Business Profile"],
  ["google_ads", "Google Ads"],
  ["organic_search", "Google search"],
  ["other", "Other"],
];
const SERVICES = ["florals", "centerpieces", "ceremony", "backdrop", "draping", "lighting", "rentals", "bridal_bouquet", "installations"];

export function NewLeadForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createLeadAction, null);
  const [probe, setProbe] = useState({ email: "", phone: "", firstName: "", lastName: "", partnerName: "", eventDate: "" });
  const [matches, setMatches] = useState<Match[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const enough = probe.email.length > 4 || probe.phone.replace(/\D/g, "").length >= 10 || (probe.lastName.length > 1 && (probe.firstName.length > 1 || probe.eventDate));
    if (!enough) {
      setMatches([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        setMatches(await checkDuplicatesAction(probe));
      } catch {
        /* ignore */
      }
    }, 350);
  }, [probe]);

  const bind = (k: keyof typeof probe) => ({
    name: k,
    value: probe[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setProbe((p) => ({ ...p, [k]: e.target.value })),
  });

  return (
    <form action={action} className="space-y-4">
      <div aria-live="polite">
        {matches.length > 0 && (
          <div className="card border-amber/50 bg-amber-soft/60 p-3 text-sm">
            <p className="font-medium text-amber">Possible match{matches.length > 1 ? "es" : ""}</p>
            <ul className="mt-1 space-y-1">
              {matches.map((m) => (
                <li key={m.id}>
                  <Link href={`/leads/${m.id}`} className="underline" target="_blank">
                    {m.recordId} {m.name || "(no name)"}
                  </Link>
                  , {titleCase(m.eventType)} {m.eventDate ? fmtDate(m.eventDate) : ""}
                  <span className="text-muted"> · {m.reasons.map((r) => MATCH_REASON_LABELS[r as MatchReason]).join(", ")}</span>
                  {m.confidence === "high" && <span className="chip ml-2 border-bloom/40 text-bloom">exact</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">Open it to update the existing record, or carry on to create a separate lead.</p>
          </div>
        )}
      </div>

      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="text-lg sm:col-span-2">Contact</h2>
        <Field label="First name"><input className="input" {...bind("firstName")} autoFocus /></Field>
        <Field label="Last name"><input className="input" {...bind("lastName")} /></Field>
        <Field label="Partner name (weddings)"><input className="input" {...bind("partnerName")} /></Field>
        <div />
        <Field label="Email"><input className="input" type="email" {...bind("email")} /></Field>
        <Field label="Phone"><input className="input" type="tel" {...bind("phone")} /></Field>
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-3">
        <h2 className="text-lg sm:col-span-3">Event</h2>
        <Field label="Event type">
          <select name="eventType" className="input" defaultValue="wedding">
            <option value="wedding">Wedding</option>
            <option value="corporate">Corporate (gala, fundraiser, prom)</option>
            <option value="social">Social</option>
            <option value="rental_only">Rentals only</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Event date"><input className="input" type="date" {...bind("eventDate")} /></Field>
        <Field label="Guests"><input className="input" name="guestCount" inputMode="numeric" /></Field>
        <Field label="Venue"><input className="input" name="venueName" /></Field>
        <Field label="Venue city"><input className="input" name="venueCity" placeholder="e.g. Vaughan" /></Field>
        <Field label="Budget"><input className="input" name="budget" placeholder="e.g. $6,000–8,000" /></Field>
        <Field label="Tier interest">
          <select name="tierInterest" className="input" defaultValue="">
            <option value="">Not sure</option>
            <option value="effortless">Effortless</option>
            <option value="elegant">Elegant</option>
            <option value="elevated">Elevated</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <fieldset className="sm:col-span-3">
          <legend className="label">Services</legend>
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((s) => (
              <label key={s} className="chip cursor-pointer border-edge bg-paper font-normal">
                <input type="checkbox" name="services" value={s} /> {titleCase(s)}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Notes / message" className="sm:col-span-3">
          <textarea name="message" rows={3} className="input" />
        </Field>
      </section>

      <section className="card grid gap-3 p-4 sm:grid-cols-3">
        <h2 className="text-lg sm:col-span-3">Source</h2>
        <Field label="How did they find us?">
          <select name="source" className="input" defaultValue="phone">
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Detail (referrer, venue partner, show)"><input name="sourceDetail" className="input" /></Field>
        <Field label="Campaign key (optional)"><input name="utmCampaign" className="input" placeholder="e.g. spring-bridal-show-2027" /></Field>
      </section>

      <div className="flex items-center gap-3">
        <button className="btn-primary px-5 py-2" disabled={pending}>{pending ? "Saving…" : "Create lead"}</button>
        <Link href="/leads" className="btn-ghost">Cancel</Link>
        {state && !state.ok && <span className="text-sm text-bloom">{state.error}</span>}
      </div>
    </form>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
