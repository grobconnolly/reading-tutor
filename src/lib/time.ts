/* Calendar helpers. The reward week runs Monday 00:00 to Sunday 23:59 in the parent's time zone. */

export const TZ = "America/Los_Angeles";

interface Parts {
  y: number;
  m: number;
  d: number;
  /** 0 = Sunday .. 6 = Saturday */
  weekday: number;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Calendar date parts of an instant in the given time zone. */
export function localParts(date: Date, tz: string = TZ): Parts {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(date)) parts[p.type] = p.value;
  return { y: +parts.year, m: +parts.month, d: +parts.day, weekday: WD[parts.weekday] ?? 0 };
}

function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 'YYYY-MM-DD' of the calendar day in the time zone. */
export function dayKey(date: Date = new Date(), tz: string = TZ): string {
  const { y, m, d } = localParts(date, tz);
  return key(y, m, d);
}

/** Shift a 'YYYY-MM-DD' key by n days (calendar arithmetic, time-zone free). */
export function shiftDayKey(dk: string, n: number): string {
  const [y, m, d] = dk.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return key(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 'YYYY-MM-DD' of the Monday that starts the week containing the instant, in the time zone. */
export function weekKey(date: Date = new Date(), tz: string = TZ): string {
  const { y, m, d, weekday } = localParts(date, tz);
  const back = (weekday + 6) % 7; // Monday = 0
  return shiftDayKey(key(y, m, d), -back);
}

/** Consecutive days with activity ending today or yesterday. */
export function streakFromDays(days: Set<string>, now: Date = new Date(), tz: string = TZ): number {
  let d = dayKey(now, tz);
  if (!days.has(d)) d = shiftDayKey(d, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = shiftDayKey(d, -1);
  }
  return n;
}

/** Friendly label for a week key, e.g. "week of Oct 13". */
export function weekLabel(wk: string): string {
  const [y, m, d] = wk.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  return "week of " + t.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
