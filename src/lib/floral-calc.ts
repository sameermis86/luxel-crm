/**
 * Wholesale stem order, supplier-agnostic:
 *   stems needed  = Σ over arrangements (recipe stem count × arrangement quantity) + one-off stems
 *   with buffer   = ceil(needed × (1 + waste%))
 *   bunches       = ceil(with buffer ÷ stems per bunch)
 *   stems ordered = bunches × stems per bunch
 */

export interface StemRef {
  id: string;
  name: string;
  perBunch: number;
}
export interface RecipeLine {
  stemId: string;
  qty: number;
}
export interface EventLine {
  eventId: string;
  eventName: string;
  eventDate: string;
  label: string;
  qty: number;
  /** recipe stems (per one arrangement); empty for a one-off stem line */
  stems: RecipeLine[];
}

export interface OrderRow {
  stemId: string;
  name: string;
  perBunch: number;
  needed: number;
  withBuffer: number;
  bunches: number;
  ordered: number;
  /** per event: stems needed there (before buffer) */
  byEvent: { eventId: string; eventName: string; eventDate: string; needed: number }[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function stemsForLine(line: Pick<EventLine, "qty" | "stems">): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of line.stems) out.set(s.stemId, round((out.get(s.stemId) ?? 0) + s.qty * line.qty));
  return out;
}

export function buildOrder(lines: EventLine[], stems: StemRef[], wastePct: number): OrderRow[] {
  const byId = new Map(stems.map((s) => [s.id, s]));
  const acc = new Map<string, { needed: number; byEvent: Map<string, OrderRow["byEvent"][number]> }>();
  for (const l of lines) {
    for (const [stemId, n] of stemsForLine(l)) {
      if (!byId.has(stemId) || n <= 0) continue;
      const a = acc.get(stemId) ?? { needed: 0, byEvent: new Map() };
      a.needed = round(a.needed + n);
      const e = a.byEvent.get(l.eventId) ?? { eventId: l.eventId, eventName: l.eventName, eventDate: l.eventDate, needed: 0 };
      e.needed = round(e.needed + n);
      a.byEvent.set(l.eventId, e);
      acc.set(stemId, a);
    }
  }
  const rows: OrderRow[] = [];
  for (const [stemId, a] of acc) {
    const s = byId.get(stemId)!;
    const perBunch = Math.max(1, Math.round(s.perBunch));
    const withBuffer = Math.ceil(round(a.needed * (1 + Math.max(0, wastePct) / 100)));
    const bunches = Math.ceil(withBuffer / perBunch);
    rows.push({
      stemId, name: s.name, perBunch, needed: Math.ceil(a.needed), withBuffer, bunches, ordered: bunches * perBunch,
      byEvent: [...a.byEvent.values()].sort((x, y) => x.eventDate.localeCompare(y.eventDate)),
    });
  }
  return rows.sort((x, y) => x.name.localeCompare(y.name));
}

export function orderCsv(rows: OrderRow[]): string {
  const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const head = ["Stem", "Stems needed", "With buffer", "Stems per bunch", "Bunches", "Stems ordered", "Events"];
  return [head, ...rows.map((r) => [r.name, r.needed, r.withBuffer, r.perBunch, r.bunches, r.ordered, r.byEvent.map((e) => `${e.eventName} (${e.eventDate}): ${e.needed}`).join("; ")])]
    .map((r) => r.map(esc).join(","))
    .join("\n");
}

/** Goodshuffle lines that are probably florals (to remind the team what to plan). */
export const FLORAL_HINT = /flor|flower|bouquet|boutonn|corsage|centerpiece|centrepiece|arrangement|greenery|garland|wreath|petal|arch/i;
