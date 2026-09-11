export const WINDOW_OFFSETS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4] as const;

function ymdInTz(d: Date, tz: string): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function windowDates(tz: string, now: Date = new Date()): string[] {
  const todayYmd = ymdInTz(now, tz);
  const base = new Date(todayYmd + "T00:00:00Z"); // anchor at UTC midnight of that calendar day
  return WINDOW_OFFSETS.map((off) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + off);
    return d.toISOString().slice(0, 10);
  });
}

export type StripCheckin = {
  circle_id: string; occurred_on: string; mood: "good" | "ok" | "hard"; has_content: boolean;
};
export type StripShift = {
  circle_id: string; starts_at: string; caregiver_name: string | null; activity_tags: string[];
};
export interface StripDay {
  date: string; offset: number; isPast: boolean;
  mood: "good" | "ok" | "hard" | null; noteHidden: boolean; checkinOn: boolean;
  shifts: { caregiverName: string | null; tags: string[] }[];
}

export function weekStrip(
  circleId: string, dates: string[], checkins: StripCheckin[], shifts: StripShift[],
): StripDay[] {
  for (const c of checkins) if (c.circle_id !== circleId) throw new Error(`checkin from circle ${c.circle_id}, expected ${circleId}`);
  for (const s of shifts) if (s.circle_id !== circleId) throw new Error(`shift from circle ${s.circle_id}, expected ${circleId}`);
  const todayIdx = 6;
  return dates.map((date, i) => {
    const day = checkins.filter((c) => c.occurred_on === date);
    const latest = day.length ? day[day.length - 1] : null;
    return {
      date, offset: WINDOW_OFFSETS[i], isPast: i <= todayIdx,
      mood: latest ? latest.mood : null,
      noteHidden: !!latest && !latest.has_content,
      checkinOn: !!latest,
      shifts: shifts
        .filter((s) => s.starts_at.slice(0, 10) === date)
        .map((s) => ({ caregiverName: s.caregiver_name, tags: s.activity_tags })),
    };
  });
}

export interface ShiftHeaderContext {
  date: string | null; mood: "good" | "ok" | "hard" | null;
  excerpt: string | null; noteHidden: boolean;
}
export function shiftHeaderContext(
  prior: { occurred_on: string; mood: "good" | "ok" | "hard"; transcript: string; translation: string } | null,
  _tz: string,
): ShiftHeaderContext {
  if (!prior) return { date: null, mood: null, excerpt: null, noteHidden: false };
  const text = prior.translation || prior.transcript;
  if (!text) return { date: prior.occurred_on, mood: prior.mood, excerpt: null, noteHidden: true };
  return {
    date: prior.occurred_on, mood: prior.mood,
    excerpt: text.length > 90 ? text.slice(0, 88).trimEnd() + "…" : text,
    noteHidden: false,
  };
}
