import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now()
    where id = any($1)`, [[fx.users.A1_coordinator, fx.users.A1_caregiver_hired]]);
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

test("coordinator sees words on all tiers she recorded", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/checkins`).set(auth(jwt));
  expect(res.status).toBe(200);
  const moodOnly = res.body.find((r: any) => r.visibility === "mood_only");
  expect(moodOnly.transcript).toBe("words"); // she is the recorder
  // regression guard: occurred_on must be a plain "YYYY-MM-DD" string, not a
  // Date-serialized ISO timestamp (pg parses a bare `date` column as a JS
  // Date unless explicitly cast — see checkins.ts's occurred_on::text casts).
  expect(moodOnly.occurred_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("hired caregiver: mood_only row present but redacted", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/checkins`).set(auth(jwt));
  const moodOnly = res.body.find((r: any) => r.visibility === "mood_only");
  expect(moodOnly.mood).toBe("ok");         // existence + mood
  expect(moodOnly.transcript).toBeNull();   // words hidden
  expect(moodOnly.has_audio).toBe(false);
});

test("GET /demo/utterances -> 404 on a non-demo circle", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/demo/utterances`).set(auth(jwt));
  expect(res.status).toBe(404);
});

test("GET /today reports has_checkin correctly", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/today`).set(auth(jwt));
  expect(res.status).toBe(200);
  expect(typeof res.body.today).toBe("string");
  expect(res.body.has_checkin).toBe(true);  // fixture seeds today's check-ins
});
