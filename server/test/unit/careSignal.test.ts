import { describe, expect, test } from "vitest";
import { windowDates, weekStrip, shiftHeaderContext } from "../../src/domain/careSignal.js";

describe("windowDates", () => {
  test("11 consecutive dates centred on today-in-tz", () => {
    const d = windowDates("America/Toronto", new Date("2026-09-08T12:00:00Z"));
    expect(d).toHaveLength(11);
    expect(d[6]).toBe("2026-09-08");
    expect(d[0]).toBe("2026-09-02");
    expect(d[10]).toBe("2026-09-12");
  });
  test("handles the DST fall-back day (2 Nov 2025)", () => {
    const d = windowDates("America/Toronto", new Date("2025-11-02T12:00:00Z"));
    expect(d[6]).toBe("2025-11-02");
    expect(d[7]).toBe("2025-11-03");
  });
});

describe("weekStrip", () => {
  const dates = windowDates("America/Toronto", new Date("2026-09-08T12:00:00Z"));
  test("maps mood onto the right day and flags hidden notes", () => {
    const strip = weekStrip("c1", dates,
      [{ circle_id: "c1", occurred_on: "2026-09-07", mood: "hard", has_content: false }],
      []);
    const d = strip.find((x) => x.date === "2026-09-07")!;
    expect(d.mood).toBe("hard");
    expect(d.noteHidden).toBe(true);
  });
  test("throws if a row is from another circle", () => {
    expect(() => weekStrip("c1", dates,
      [{ circle_id: "cX", occurred_on: "2026-09-07", mood: "ok", has_content: true }], []),
    ).toThrow(/circle/i);
  });
});

describe("shiftHeaderContext", () => {
  test("content present -> excerpt", () => {
    const r = shiftHeaderContext(
      { occurred_on: "2026-09-07", mood: "good", transcript: "slept well", translation: "slept well" },
      "America/Toronto");
    expect(r.excerpt).toBe("slept well");
    expect(r.noteHidden).toBe(false);
  });
  test("content absent -> noteHidden", () => {
    const r = shiftHeaderContext(
      { occurred_on: "2026-09-07", mood: "good", transcript: "", translation: "" },
      "America/Toronto");
    expect(r.noteHidden).toBe(true);
    expect(r.excerpt).toBeNull();
  });
  test("no prior check-in -> nulls", () => {
    expect(shiftHeaderContext(null, "America/Toronto")).toEqual(
      { date: null, mood: null, excerpt: null, noteHidden: false });
  });
});
