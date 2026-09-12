import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt } from "../db/clients.js";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

test("GET /api/me returns the caller's profile and circles", async () => {
  const jwt = await mintJwt({ sub: fx.users.twoCircle, email: "twoCircle@example.com" });
  const res = await request(createApp()).get("/api/me").set("Authorization", `Bearer ${jwt}`);
  expect(res.status).toBe(200);
  expect(res.body.profile.id).toBe(fx.users.twoCircle);
  expect(res.body.circles.map((c: any) => c.id).sort())
    .toEqual([fx.circleA2, fx.circleB1].sort());
});

test("accept-notice sets tos_accepted_at", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const app = createApp();
  const r1 = await request(app).post("/api/me/accept-notice")
    .set("Authorization", `Bearer ${jwt}`).send({ version: "2026-09-08" });
  expect(r1.status).toBe(204);
  const me = await request(app).get("/api/me").set("Authorization", `Bearer ${jwt}`);
  expect(me.body.profile.tos_accepted_at).not.toBeNull();
});
