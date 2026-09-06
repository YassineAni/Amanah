// Expand the weekly routine + per-day completions + ad-hoc items into the flat
// day view the frontend renders. Nothing per-date is stored until it's done.
import type { AdHocTask, Completion, PlanRow, RoutineItem } from './types.js'

export function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00').getDay()
}

export function expandDay(
  date: string,
  routine: RoutineItem[],
  completions: Completion[],
  adHoc: AdHocTask[],
): PlanRow[] {
  const wd = weekdayOf(date)
  const rows: PlanRow[] = []

  for (const r of routine) {
    if (!r.weekdays.includes(wd)) continue
    const c = completions.find((x) => x.routineItemId === r.id && x.date === date)
    rows.push({
      key: `r:${r.id}`,
      kind: 'routine',
      title: r.title,
      scheduledTime: r.time,
      category: r.category,
      timeSensitive: r.timeSensitive,
      doneAt: c?.doneAt ?? null,
      doneById: c?.doneById ?? null,
      doneByName: c?.doneByName ?? null,
      note: c?.note ?? null,
      weekdays: r.weekdays,
    })
  }

  for (const a of adHoc.filter((x) => x.date === date)) {
    rows.push({
      key: `a:${a.id}`,
      kind: 'adhoc',
      title: a.title,
      scheduledTime: a.time,
      category: a.category,
      timeSensitive: a.timeSensitive,
      doneAt: a.doneAt,
      doneById: a.doneById,
      doneByName: a.doneByName,
      note: a.note ?? null,
      addedByName: a.addedByName,
    })
  }

  rows.sort((x, y) =>
    x.scheduledTime < y.scheduledTime ? -1 : x.scheduledTime > y.scheduledTime ? 1 : 0,
  )
  return rows
}
