import { beforeAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

/** does `user` get the content row for check-in `key`? */
async function canSeeContent(user: string, key: string): Promise<boolean> {
  const r = await asUser(fx.users[user], (c) =>
    c.query("select checkin_id from public.checkin_content where checkin_id = $1",
      [fx.checkins[key]]),
  );
  return r.rowCount === 1;
}

describe("consent-tier matrix (proxy check-ins recorded by the coordinator)", () => {
  // circle: everyone in the circle
  test("circle -> hired caregiver YES", async () => {
    expect(await canSeeContent("A1_caregiver_hired", "A1_circle")).toBe(true);
  });
  // family: coordinator OR is_family_member OR recorder
  test("family -> family member YES", async () => {
    expect(await canSeeContent("A1_family", "A1_family")).toBe(true);
  });
  test("family -> hired caregiver NO", async () => {
    expect(await canSeeContent("A1_caregiver_hired", "A1_family")).toBe(false);
  });
  test("family -> the elder NO (proxy coordinator-recorded, family tier, elder is is_family) YES", async () => {
    // elder IS is_family_member in A1 -> family tier admits her
    expect(await canSeeContent("A1_elder", "A1_family")).toBe(true);
  });
  // coordinator: coordinator OR recorder
  test("coordinator -> coordinator YES", async () => {
    expect(await canSeeContent("A1_coordinator", "A1_coordinator")).toBe(true);
  });
  test("coordinator -> family member NO", async () => {
    expect(await canSeeContent("A1_family", "A1_coordinator")).toBe(false);
  });
  test("coordinator -> the elder NO (proxy, coordinator tier)", async () => {
    expect(await canSeeContent("A1_elder", "A1_coordinator")).toBe(false);
  });
  // mood_only: only the recorder
  test("mood_only -> coordinator (the recorder) YES", async () => {
    expect(await canSeeContent("A1_coordinator", "A1_moodonly")).toBe(true);
  });
  test("mood_only -> everyone else NO", async () => {
    expect(await canSeeContent("A1_family", "A1_moodonly")).toBe(false);
    expect(await canSeeContent("A1_elder", "A1_moodonly")).toBe(false);
    expect(await canSeeContent("A1_caregiver_hired", "A1_moodonly")).toBe(false);
  });
  // the elder's own recording — always full
  test("elder self-recording -> the elder YES", async () => {
    expect(await canSeeContent("A1_elder", "A1_elder_self")).toBe(true);
  });
});

test("a member can read the parent checkins row but NOT the content", async () => {
  const parent = await asUser(fx.users.A1_caregiver_hired, (c) =>
    c.query("select id, mood from public.checkins where id = $1", [fx.checkins.A1_moodonly]),
  );
  expect(parent.rowCount).toBe(1);            // existence + mood are visible
  expect(await canSeeContent("A1_caregiver_hired", "A1_moodonly")).toBe(false);
});

test("checkins has no transcript column to leak", async () => {
  await expect(
    asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("select transcript from public.checkins limit 1")),
  ).rejects.toThrow(/column .*transcript.* does not exist/i);
});
