import { beforeEach, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt } from "../db/clients.js";

let fx: Fixture;
beforeEach(async () => { fx = await loadFixture(); });
const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

// Closes a gap found during 1c's frontend-wiring pass: nothing in 1b let a
// client list a circle's roster (GET /api/me only returns the caller's own
// circles, not who else is in one) — blocking the coordinator screen's
// caregiver-assignment dropdown and family/caregiver labeling.

test("any active member can list the circle's roster", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/members`).set(auth(jwt));
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(4); // coordinator, elder, hired caregiver, family
  const byRole = Object.fromEntries(res.body.map((m: any) => [m.role, m]));
  expect(byRole.coordinator.name).toBeTruthy();
  expect(byRole.caregiver.is_family_member).toBe(false); // A1_caregiver_hired
  expect(byRole.family.is_family_member).toBe(true);
});

test("a non-member -> 403", async () => {
  const jwt = await mintJwt({ sub: fx.users.B1_coordinator, email: "b@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/members`).set(auth(jwt));
  expect(res.status).toBe(403);
});

test("no token -> 401", async () => {
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/members`);
  expect(res.status).toBe(401);
});

test("a removed member does not appear", async () => {
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const app = createApp();
  // A2 has 2 coordinators (A2_coordinator, twoCircle) so removing one is
  // allowed (not the last-coordinator guard).
  const del = await request(app)
    .delete(`/api/circles/${fx.circleA2}/members/${fx.users.twoCircle}`).set(auth(jwt));
  expect(del.status).toBe(204);

  const res = await request(app).get(`/api/circles/${fx.circleA2}/members`).set(auth(jwt));
  expect(res.status).toBe(200);
  expect(res.body.find((m: any) => m.id === fx.users.twoCircle)).toBeUndefined();
});
