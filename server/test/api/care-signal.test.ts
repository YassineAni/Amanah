import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";
import { windowDates } from "../../src/domain/careSignal.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now() where id = any($1)`,
    [[fx.users.A1_coordinator, fx.users.twoCircle]]);
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

test("care-signal returns an 11-day window scoped to the circle", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/care-signal`).set(auth(jwt));
  expect(res.status).toBe(200);
  expect(res.body.window).toHaveLength(11);
  expect(res.body.days).toHaveLength(11);
});

test("multi-circle viewer only sees circle A2's rows via /api/circles/:A2/care-signal", async () => {
  // twoCircle is coordinator of A2 and family of B1; ask for A2 -> weekStrip
  // asserts single circle, so a leak from B1 would throw 500.
  const jwt = await mintJwt({ sub: fx.users.twoCircle, email: "twoCircle@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA2}/care-signal`).set(auth(jwt));
  expect(res.status).toBe(200);
});

test("a shift near local midnight buckets by the circle's timezone, not UTC", async () => {
  // circleA1's timezone is America/Toronto (UTC-4/-5). Construct a
  // starts_at that is "today" in Toronto but already "tomorrow" in UTC —
  // if the SQL bucketed by a bare ::date cast (session default, UTC) this
  // shift would land one day later than it should. Regression guard for
  // the careSignal.ts/shifts.ts timezone-cast fix.
  const dates = windowDates("America/Toronto");
  const todayLocal = dates[6];
  const tomorrowUtcAt2am = new Date(`${todayLocal}T00:00:00Z`);
  tomorrowUtcAt2am.setUTCDate(tomorrowUtcAt2am.getUTCDate() + 1);
  tomorrowUtcAt2am.setUTCHours(2, 0, 0, 0);

  const c = admin(); await c.connect();
  await c.query(
    `insert into public.shifts (circle_id, starts_at, ends_at, caregiver_id, purpose)
     values ($1, $2::timestamptz, $2::timestamptz + interval '2 hours', $3, 'boundary shift')`,
    [fx.circleA1, tomorrowUtcAt2am.toISOString(), fx.users.A1_caregiver_hired]);
  await c.end();

  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/care-signal`).set(auth(jwt));
  expect(res.status).toBe(200);

  const todayCell = res.body.days.find((d: any) => d.date === todayLocal);
  const tomorrowCell = res.body.days.find((d: any) => d.date === dates[7]);
  expect(todayCell.shifts.length).toBeGreaterThanOrEqual(1);
  expect(tomorrowCell?.shifts.length ?? 0).toBe(0);
});

test("GET /api/my-shifts returns upcoming shifts across every circle, scoped to the caller", async () => {
  const c = admin(); await c.connect();
  await c.query(
    `insert into public.shifts (circle_id, starts_at, ends_at, caregiver_id, purpose, coordinator_note)
     values ($1, now() + interval '1 day', now() + interval '1 day 2 hours', $2, 'future visit', 'watch for the step by the door')`,
    [fx.circleA1, fx.users.A1_coordinator]);
  await c.end();

  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/my-shifts`).set(auth(jwt));
  expect(res.status).toBe(200);
  const mine = res.body.shifts.find((s: any) => s.circle_id === fx.circleA1);
  expect(mine).toBeTruthy();
  expect(res.body.shifts.every((s: any) => s.circle_id !== fx.circleB1)).toBe(true);
  // Regression guard: the query previously omitted coordinator_note from its
  // SELECT list entirely — the frontend's caregiver screen shows this note
  // ("From your coordinator"), so a silently-missing field here isn't a
  // typecheck error, it's a caregiver never seeing a note that exists.
  expect(mine.coordinator_note).toBe("watch for the step by the door");
});
