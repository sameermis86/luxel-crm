import type { Status } from "@/db/schema";
import type { Settings } from "./config/defaults";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

type BH = Settings["businessHours"];
type FU = Settings["followUps"];

/** Add business hours in the studio's time zone (skips nights + non-working days, DST-safe). */
export function addBusinessHours(start: Date, hours: number, bh: BH): Date {
  let remainingMin = Math.round(hours * 60);
  // walk in wall-clock time
  let wall = toZonedTime(start, bh.timezone);
  const toUtc = (w: Date) => fromZonedTime(w, bh.timezone);
  const setTime = (w: Date, h: number) => {
    const d = new Date(w);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const nextDay = (w: Date) => {
    const d = new Date(w);
    d.setDate(d.getDate() + 1);
    d.setHours(bh.startHour, 0, 0, 0);
    return d;
  };
  for (let guard = 0; guard < 400; guard++) {
    if (!bh.days.includes(wall.getDay())) {
      wall = nextDay(wall);
      continue;
    }
    const open = setTime(wall, bh.startHour);
    const close = setTime(wall, bh.endHour);
    if (wall < open) wall = open;
    if (wall >= close) {
      wall = nextDay(wall);
      continue;
    }
    const available = (close.getTime() - wall.getTime()) / 60000;
    if (remainingMin <= available) return toUtc(new Date(wall.getTime() + remainingMin * 60000));
    remainingMin -= available;
    wall = nextDay(wall);
  }
  return toUtc(wall);
}

const DAY = 86_400_000;

/** Default next follow-up after an activity, by the lead's (new) status. */
export function suggestNextFollowUp(status: Status, now: Date, f: FU, consultAt?: Date | null): Date {
  if (status === "consult_scheduled" && consultAt) {
    const t = consultAt.getTime() - f.beforeConsultDays * DAY;
    return new Date(Math.max(t, now.getTime()));
  }
  if (status === "proposal_sent") return new Date(now.getTime() + f.afterProposalDays * DAY);
  return new Date(now.getTime() + f.afterContactedDays * DAY);
}
