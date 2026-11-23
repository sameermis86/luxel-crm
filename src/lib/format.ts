import { formatInTimeZone } from "date-fns-tz";
import { TZ } from "./dates";

export const fmtMoney = (n: number | null | undefined, opts: { cents?: boolean } = {}) =>
  n == null ? "—" : n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: opts.cents ? 2 : 0 });
export const fmtMoneyShort = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`;
  return fmtMoney(n);
};
export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? formatInTimeZone(new Date(d), TZ, "MMM d, yyyy h:mm a") : "—");
export const fmtShortDateTime = (d: Date | string | null | undefined) => (d ? formatInTimeZone(new Date(d), TZ, "MMM d, h:mm a") : "—");
export const fmtRelative = (d: Date | string | null | undefined, now = new Date()) => {
  if (!d) return "—";
  const diff = new Date(d).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60000);
  const h = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const s = m < 60 ? `${m}m` : h < 36 ? `${h}h` : `${days}d`;
  return diff < 0 ? `${s} ago` : `in ${s}`;
};
export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "—");
export const titleCase = (s: string | null | undefined) => (s ? human(s).replace(/\b\w/g, (c) => c.toUpperCase()) : "—");
export const fullName = (l: { firstName?: string | null; lastName?: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ") || "(no name)";
export const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
/** value for <input type="datetime-local"> in Toronto time */
export const toLocalInput = (d: Date | null | undefined) => (d ? formatInTimeZone(d, TZ, "yyyy-MM-dd'T'HH:mm") : "");
