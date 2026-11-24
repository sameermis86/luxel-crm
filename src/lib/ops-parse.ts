import { clientName, projectNumber, venueName, type IcsEvent } from "./goodshuffle";

/**
 * Goodshuffle writes each project into its Google Calendar entry like this:
 *
 *   Status: Contract Signed
 *   Project: Rossi - Kortright Wedding (231716065)
 *   Venue: Kortright Centre
 *   Event Date/Time: Saturday, 11/6 [10:00 am] - Sunday, 11/7 [1:00 am]
 *   Sales Lead: …
 *   <b>Item Category Pullsheet:</b> <a href='…'>Printed</a>
 *   …
 *   <b>Contract Notes (Internal):</b> …
 *   <b>Contract Notes (Client Visible):</b> …
 *   <b>---- Head Table for Nov 6 - Nov 7, 2027 (Top-level only) ----</b>
 *   Item: Head Table Decor (16 People) (Qty: 1)
 *   <b>---- Logistics  ----</b>
 *   Item: Standard Delivery Package Drop-Off (Qty: 1)
 *
 * Items are top-level packages; components are added by the team on the pull sheet.
 */

export interface OpsItem {
  area: string;
  name: string;
  qty: number;
  logistics: boolean;
}

export interface OpsProject {
  project: string | null;
  name: string;
  client: string | null;
  venue: string | null;
  timeText: string | null;
  salesLead: string | null;
  notesInternal: string | null;
  notesClient: string | null;
  links: Partial<Record<"pullsheetByCategory" | "pullsheetByGroup" | "schedule" | "fulfillmentSheet" | "project", string>>;
  areas: string[];
  items: OpsItem[];
}

const decode = (s: string) =>
  s.replace(/&#9;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, ""));

const headerValue = (text: string, label: string) => {
  const m = text.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() || null : null;
};

/** "<b>Label:</b> <a href='x'>Printed</a>" → x (prefers the Printed link). */
function linkAfter(desc: string, label: string): string | undefined {
  const i = desc.indexOf(`<b>${label}`);
  if (i < 0) return undefined;
  const line = desc.slice(i, desc.indexOf("\n", i) < 0 ? undefined : desc.indexOf("\n", i));
  const links = [...line.matchAll(/<a href=['"]([^'"]+)['"]>([^<]*)<\/a>/g)].map((m) => ({ href: decode(m[1]), label: m[2] }));
  return (links.find((l) => /printed/i.test(l.label)) ?? links[0])?.href;
}

/** Notes block: everything after "<b>Contract Notes (X):</b>" up to the next bold header. */
function notes(desc: string, which: "Internal" | "Client Visible"): string | null {
  const re = new RegExp(`<b>Contract Notes \\(${which.replace(" ", "\\s")}\\):</b>([\\s\\S]*?)(?=<b>|$)`, "i");
  const m = desc.match(re);
  const text = m ? stripTags(m[1]).trim() : "";
  return text || null;
}

const AREA_RE = /^-{2,}\s*(.+?)\s*-{2,}$/;
const ITEM_RE = /^Item:\s*(.+?)\s*\(Qty:\s*(\d+(?:\.\d+)?)\)\s*$/i;

export function parseProject(ev: Pick<IcsEvent, "summary" | "description">): OpsProject {
  const desc = ev.description;
  const items: OpsItem[] = [];
  const areas: string[] = [];
  let area = "General";
  for (const raw of desc.split("\n")) {
    const line = stripTags(raw).trim();
    const a = line.match(AREA_RE);
    if (a) {
      // "Head Table for Nov 6 - Nov 7, 2027 (Top-level only)" → "Head Table"
      area = a[1].replace(/\s*\(Top-level only\)\s*$/i, "").replace(/\s+for\s+[A-Z][a-z]{2}\s+\d.*$/, "").trim() || "General";
      if (!areas.includes(area)) areas.push(area);
      continue;
    }
    const it = line.match(ITEM_RE);
    if (it) {
      if (!areas.includes(area)) areas.push(area);
      items.push({ area, name: it[1].trim(), qty: Number(it[2]), logistics: /^logistics$/i.test(area) });
    }
  }
  const projectLine = headerValue(desc, "Project");
  return {
    project: projectNumber(ev),
    name: (projectLine ? projectLine.replace(/\s*\(\d{4,}\)\s*$/, "") : ev.summary).trim() || ev.summary,
    client: clientName(ev),
    venue: venueName(ev),
    timeText: headerValue(desc, "Event Date/Time") ?? headerValue(desc, "Event Date") ?? null,
    salesLead: headerValue(desc, "Sales Lead"),
    notesInternal: notes(desc, "Internal"),
    notesClient: notes(desc, "Client Visible"),
    links: {
      pullsheetByCategory: linkAfter(desc, "Item Category Pullsheet"),
      pullsheetByGroup: linkAfter(desc, "Line Item Group Pullsheet"),
      schedule: linkAfter(desc, "Schedule"),
      fulfillmentSheet: linkAfter(desc, "Receipt of Goods"),
      project: linkAfter(desc, "Project Details"),
    },
    areas,
    items,
  };
}

export interface TaskTemplate {
  setup: string[];
  teardown: string[];
}

/**
 * Checklist for one event: per decor area, the setup and teardown steps from the template
 * ("{area}" is replaced), plus one task per logistics line (drop-off → setup, pickup/teardown → teardown).
 */
export function buildTasks(p: Pick<OpsProject, "areas" | "items">, tpl: TaskTemplate) {
  const out: { phase: "setup" | "teardown"; area: string; title: string }[] = [];
  const decorAreas = p.areas.filter((a) => !/^logistics$/i.test(a));
  for (const phase of ["setup", "teardown"] as const) {
    for (const area of decorAreas) for (const t of tpl[phase]) out.push({ phase, area, title: t.replace(/\{area\}/g, area) });
  }
  for (const it of p.items.filter((i) => i.logistics)) {
    // "Ceremony Delivery and Teardown … Drop-Off" is a drop-off: the Drop-Off/Pickup suffix decides
    const teardown = !/drop-?off/i.test(it.name) && /pick ?up|teardown|strike/i.test(it.name);
    out.push({ phase: teardown ? "teardown" : "setup", area: "Logistics", title: it.name });
  }
  return out;
}
