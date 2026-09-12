import { describe, expect, test } from "vitest";
import { resolveSpokenLang, demoTranscribe } from "../../src/domain/transcribe.js";

describe("resolveSpokenLang", () => {
  test("body language wins when present", () => {
    expect(resolveSpokenLang("fr", "ar")).toBe("fr");
  });
  test("falls back to the circle elder_lang", () => {
    expect(resolveSpokenLang("", "ar")).toBe("ar");
    expect(resolveSpokenLang(undefined, "fr")).toBe("fr");
  });
  test("final fallback is ar", () => {
    expect(resolveSpokenLang(undefined, "")).toBe("ar");
  });
});

describe("demoTranscribe", () => {
  test("returns the seeded utterance", () => {
    const r = demoTranscribe("u2");
    expect(r.spoken_lang).toBe("ar");
    expect(r.translation).toMatch(/sleep/i);
  });
  test("unknown id falls back to the first utterance", () => {
    expect(demoTranscribe("nope").transcript).toBe(demoTranscribe("u1").transcript);
  });
});
