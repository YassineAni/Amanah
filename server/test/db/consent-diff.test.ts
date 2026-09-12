import { beforeAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture.js";
import { asUser } from "./clients.js";
import { visibleCheckin } from "../../src/consent.js";

// consent.ts is the executable spec for the tier matrix. The RLS policy
// (migration 009) must produce the same yes/no on "does this viewer get the
// content row?" for every fixture cell. When this drifts, ONE of them is
// wrong — investigate before deleting consent.ts in Part 1c.
let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

type Role = "elder" | "coordinator" | "caregiver" | "family";

// Static definitions only — no fx.users lookup here. Vitest's describe/test
// registration runs at file-collection time, BEFORE beforeAll has populated
// fx; resolving fx.users.<key> happens inside each test body instead, where
// fx is guaranteed populated.
const VIEWERS: Record<string, { userKey: keyof Fixture["users"]; role: Role; isFamily: boolean }> = {
  coordinator: { userKey: "A1_coordinator", role: "coordinator", isFamily: true },
  elder:       { userKey: "A1_elder", role: "elder", isFamily: true },
  hired:       { userKey: "A1_caregiver_hired", role: "caregiver", isFamily: false },
  family:      { userKey: "A1_family", role: "family", isFamily: true },
};

const CASES: { key: string; vis: "circle"|"family"|"coordinator"|"mood_only"; authorIsElder: boolean }[] = [
  { key: "A1_circle", vis: "circle", authorIsElder: false },
  { key: "A1_family", vis: "family", authorIsElder: false },
  { key: "A1_coordinator", vis: "coordinator", authorIsElder: false },
  { key: "A1_moodonly", vis: "mood_only", authorIsElder: false },
  { key: "A1_elder_self", vis: "family", authorIsElder: true },
];

describe("RLS tier == consent.ts visibleCheckin", () => {
  for (const c of CASES) {
    for (const [vname, def] of Object.entries(VIEWERS)) {
      test(`${c.key} / ${vname}`, async () => {
        const viewerId = fx.users[def.userKey];
        const rls = (await asUser(viewerId, (q) =>
          q.query("select 1 from public.checkin_content where checkin_id = $1", [fx.checkins[c.key]]),
        )).rowCount === 1;

        const oracle = visibleCheckin(
          { id: fx.checkins[c.key], date: "2026-09-08",
            authorId: c.authorIsElder ? fx.users.A1_elder : fx.users.A1_coordinator,
            mood: "ok", transcript: "x", translation: "x", audioId: "", spokenLang: "ar",
            visibility: c.vis === "mood_only" ? "mood-only" : c.vis, createdVia: "demo" },
          { id: viewerId, name: vname, role: def.role, isFamily: def.isFamily,
            lang: "en", username: vname, password: "" },
        ) === "full";

        expect(rls).toBe(oracle);
      });
    }
  }
});
