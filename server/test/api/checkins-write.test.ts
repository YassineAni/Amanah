import { beforeAll, expect, test, vi } from "vitest";
import request from "supertest";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

vi.mock("../../src/storage/audio.js", () => ({
  uploadStaging: vi.fn(async (cid: string) => `${cid}/staging/xyz.webm`),
  promoteStaging: vi.fn(async (p: string) => p.replace("/staging/", "/")),
  signedUrl: vi.fn(async () => "https://signed.example/audio"),
  deleteCircleAudio: vi.fn(async () => {}),
}));
const { createApp } = await import("../../src/http/app.js");

let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now()
    where id = any($1)`, [[fx.users.A1_coordinator, fx.users.A1_elder, fx.users.A1_family]]);
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

test("coordinator saves a proxy check-in", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/checkins`).set(auth(jwt))
    .send({ mood: "hard", transcript: "rough day", visibility: "coordinator" });
  expect(res.status).toBe(201);
  const c = admin(); await c.connect();
  const row = await c.query(`select is_proxy from public.checkins where id = $1`, [res.body.id]);
  expect(row.rows[0].is_proxy).toBe(true);
  await c.end();
});

test("a family-role member cannot POST a check-in -> 403, not a 500", async () => {
  // Regression guard: this role gate is the app-level equivalent of the DB
  // write policy (ins_checkins/ins_checkin_content require elder/
  // coordinator/caregiver); without it the RLS 42501 reaches the client as
  // a 500 instead of a clean 403 for what is a routine authorization
  // rejection.
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/checkins`).set(auth(jwt))
    .send({ mood: "ok", transcript: "hi" });
  expect(res.status).toBe(403);
});

test("a staging_path with a path-traversal segment is rejected -> 400", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/checkins`).set(auth(jwt))
    .send({
      mood: "ok", transcript: "hi",
      staging_path: `${fx.circleA1}/staging/../../${fx.circleB1}/staging/x.webm`,
    });
  expect(res.status).toBe(400);
});

test("elder cannot PATCH visibility of a proxy coordinator-tier check-in she can't see", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_elder, email: "e@example.com" });
  const res = await request(createApp())
    .patch(`/api/circles/${fx.circleA1}/checkins/${fx.checkins.A1_coordinator}`)
    .set(auth(jwt)).send({ visibility: "circle" });
  expect(res.status).toBe(403);
});

test("GET /audio for a mood_only check-in as a hired caregiver -> 403", async () => {
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now() where id = $1`,
    [fx.users.A1_caregiver_hired]);
  await c.end();
  const jwt = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const res = await request(createApp())
    .get(`/api/circles/${fx.circleA1}/checkins/${fx.checkins.A1_moodonly}/audio`).set(auth(jwt));
  expect(res.status).toBe(403);
});
