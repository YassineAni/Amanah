export function weekdayOf(dateString: string): number {
  return new Date(dateString + "T00:00:00").getDay();
}

export type RoutineRow = {
  id: string; title: string; time_of_day: string; category: string;
  time_sensitive: boolean; weekdays: number[];
  effective_from: string; archived_at: string | null;
};
export type CompletionRow = {
  routine_item_id: string; on_date: string; done_at: string;
  done_by: string; done_by_name: string; note: string | null;
};
export type AdhocRow = {
  id: string; on_date: string; title: string; time_of_day: string; category: string;
  time_sensitive: boolean; done_at: string | null; done_by: string | null;
  done_by_name: string | null; added_by_name: string; note: string | null;
};
export type PlanRow = {
  key: string; kind: "routine" | "adhoc"; title: string; scheduledTime: string;
  category: string; timeSensitive: boolean;
  doneAt: string | null; doneById: string | null; doneByName: string | null;
  note: string | null; weekdays?: number[]; addedByName?: string;
};

export function expandDay(
  date: string, routine: RoutineRow[], completions: CompletionRow[], adhoc: AdhocRow[],
): PlanRow[] {
  const wd = weekdayOf(date);
  const rows: PlanRow[] = [];

  for (const r of routine) {
    if (!r.weekdays.includes(wd)) continue;
    if (r.effective_from > date) continue;
    if (r.archived_at !== null && r.archived_at.slice(0, 10) <= date) continue;
    const c = completions.find((x) => x.routine_item_id === r.id && x.on_date === date);
    rows.push({
      key: `r:${r.id}`, kind: "routine", title: r.title, scheduledTime: r.time_of_day,
      category: r.category, timeSensitive: r.time_sensitive,
      doneAt: c?.done_at ?? null, doneById: c?.done_by ?? null, doneByName: c?.done_by_name ?? null,
      note: c?.note ?? null, weekdays: r.weekdays,
    });
  }
  for (const a of adhoc.filter((x) => x.on_date === date)) {
    rows.push({
      key: `a:${a.id}`, kind: "adhoc", title: a.title, scheduledTime: a.time_of_day,
      category: a.category, timeSensitive: a.time_sensitive,
      doneAt: a.done_at, doneById: a.done_by, doneByName: a.done_by_name,
      note: a.note ?? null, addedByName: a.added_by_name,
    });
  }
  rows.sort((x, y) =>
    x.scheduledTime < y.scheduledTime ? -1
    : x.scheduledTime > y.scheduledTime ? 1
    : x.key < y.key ? -1 : x.key > y.key ? 1 : 0,
  );
  return rows;
}
