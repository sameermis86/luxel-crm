import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

export const TZ = "America/Toronto";

/** Calendar date (YYYY-MM-DD) of `now` in the given zone. */
export function dateInTz(now: Date, tz = TZ): string {
  return formatInTimeZone(now, tz, "yyyy-MM-dd");
}

/** Whole days from date `a` to date `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Start of a calendar date in a zone, as a UTC instant. */
export function startOfDayInTz(date: string, tz = TZ): Date {
  return fromZonedTime(`${date}T00:00:00`, tz);
}

/** Exclusive end (start of the next day) of a calendar date in a zone. */
export function endOfDayExclusiveInTz(date: string, tz = TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return startOfDayInTz(next.toISOString().slice(0, 10), tz);
}

export function firstOfMonthInTz(now: Date, tz = TZ): string {
  return dateInTz(now, tz).slice(0, 8) + "01";
}

export function lastOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addDaysToDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return addDaysToDate(date, -((dow + 6) % 7));
}

export { toZonedTime, fromZonedTime, formatInTimeZone };
