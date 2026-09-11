import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

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

test("GET /api/my-shifts returns upcoming shifts across every circle, scoped to the caller", async () => {
  const c = admin(); await c.connect();
  await c.query(
    `insert into public.shifts (circle_id, starts_at, ends_at, caregiver_id, purpose)
     values ($1, now() + interval '1 day', now() + interval '1 day 2 hours', $2, 'future visit')`,
    [fx.circleA1, fx.users.A1_coordinator]);
  await c.end();

  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/my-shifts`).set(auth(jwt));
  expect(res.status).toBe(200);
  expect(res.body.shifts.some((s: any) => s.circle_id === fx.circleA1)).toBe(true);
  expect(res.body.shifts.every((s: any) => s.circle_id !== fx.circleB1)).toBe(true);
});
