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
    [[fx.users.A1_coordinator, fx.users.A1_caregiver_hired]]);
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

test("coordinator creates and assigns a shift; caregiver checks in", async () => {
  const app = createApp();
  const coord = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const create = await request(app).post(`/api/circles/${fx.circleA1}/shifts`).set(auth(coord))
    .send({ starts_at: "2026-09-09T14:00:00Z", ends_at: "2026-09-09T16:00:00Z",
            caregiver_id: fx.users.A1_caregiver_hired });
  expect(create.status).toBe(201);

  const cg = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const ci = await request(app).patch(`/api/circles/${fx.circleA1}/shifts/${create.body.id}`)
    .set(auth(cg)).send({ checked_in_at: "2026-09-09T14:02:00Z" });
  expect(ci.status).toBe(200);
});

test("a caregiver's attempt to reassign the shift via PATCH is silently ignored, not applied", async () => {
  // The plan's own draft test asserted this scenario raises the migration
  // 013 shifts_column_scope trigger (409/500 from a checked_out-before-
  // checked_in CHECK violation). Checked the actual schema: there is no
  // ordering CHECK between checked_in_at/checked_out_at (only a presence
  // dependency, shifts_checkout_needs_checkin), and the handler below never
  // adds caregiver_id/purpose/activity_tags/coordinator_note to the SQL
  // UPDATE unless membership.role === 'coordinator' — so a non-coordinator
  // can never reach the trigger's clamp through this endpoint at all; the
  // app-level field filter is what actually enforces the boundary here.
  // Test that property directly: the reassignment is dropped, not applied.
  const app = createApp();
  const coord = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const create = await request(app).post(`/api/circles/${fx.circleA1}/shifts`).set(auth(coord))
    .send({ starts_at: "2026-09-10T14:00:00Z", ends_at: "2026-09-10T16:00:00Z",
            caregiver_id: fx.users.A1_caregiver_hired });
  const cg = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const res = await request(app).patch(`/api/circles/${fx.circleA1}/shifts/${create.body.id}`)
    .set(auth(cg)).send({ caregiver_id: fx.users.A1_coordinator, checked_in_at: "2026-09-10T14:05:00Z" });
  expect(res.status).toBe(200);
  const c = admin(); await c.connect();
  const row = await c.query(`select caregiver_id from public.shifts where id = $1`, [create.body.id]);
  expect(row.rows[0].caregiver_id).toBe(fx.users.A1_caregiver_hired); // unchanged
  await c.end();
});

test("family cannot create a shift -> 403", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/shifts`).set(auth(jwt))
    .send({ starts_at: "2026-09-11T14:00:00Z", ends_at: "2026-09-11T16:00:00Z" });
  expect(res.status).toBe(403);
});
