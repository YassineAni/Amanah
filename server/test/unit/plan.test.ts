import { describe, expect, test } from "vitest";
import { weekdayOf, expandDay } from "../../src/domain/plan.js";

describe("weekdayOf is timezone-independent", () => {
  test("2026-09-08 is a Tuesday (=2) regardless of host TZ", () => {
    expect(weekdayOf("2026-09-08")).toBe(2);
  });
});

describe("expandDay", () => {
  const routine = (over: Partial<any> = {}) => ({
    id: "r1", title: "Meds", time_of_day: "08:00", category: "medication",
    time_sensitive: true, weekdays: [1, 2, 3, 4, 5],
    effective_from: "2026-01-01", archived_at: null, ...over,
  });

  test("excludes routine items whose effective_from is after the date", () => {
    const rows = expandDay("2026-09-08", [routine({ effective_from: "2026-10-01" })], [], []);
    expect(rows).toHaveLength(0);
  });

  test("excludes routine items archived on or before the date", () => {
    const rows = expandDay("2026-09-08", [routine({ archived_at: "2026-09-08T00:00:00Z" })], [], []);
    expect(rows).toHaveLength(0);
  });

  test("stable sort: two items at 08:00 keep insertion order by key", () => {
    const rows = expandDay("2026-09-08", [
      routine({ id: "rB", time_of_day: "08:00" }),
      routine({ id: "rA", time_of_day: "08:00" }),
    ], [], []);
    expect(rows.map((r) => r.key)).toEqual(["r:rA", "r:rB"]);
  });

  test("merges a completion", () => {
    const rows = expandDay("2026-09-08", [routine()], [
      { routine_item_id: "r1", on_date: "2026-09-08", done_at: "2026-09-08T08:05:00Z",
        done_by: "u1", done_by_name: "Lea", note: "ok" },
    ], []);
    expect(rows[0].doneByName).toBe("Lea");
    expect(rows[0].note).toBe("ok");
  });
});
