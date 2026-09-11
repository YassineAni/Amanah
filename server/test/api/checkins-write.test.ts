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
    where id = any($1)`, [[fx.users.A1_coordinator, fx.users.A1_elder]]);
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
