import { beforeAll, describe, expect, test } from "vitest";
import express from "express";
import request from "supertest";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt } from "../db/clients.js";
import { requireAuth } from "../../src/auth/middleware.js";
import { requireCircle } from "../../src/auth/circle.js";

let fx: Fixture;
let app: express.Express;

beforeAll(async () => {
  fx = await loadFixture();
  app = express();
  app.get("/api/circles/:cid/probe", requireAuth as any, requireCircle("coordinator") as any,
    (req: any, res) => res.json({ role: req.membership.role }));
});

const bearer = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

describe("requireCircle", () => {
  test("coordinator of the circle -> 200", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
    const res = await request(app).get(`/api/circles/${fx.circleA1}/probe`).set(bearer(jwt));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("coordinator");
  });
  test("a member with the wrong role -> 403", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
    const res = await request(app).get(`/api/circles/${fx.circleA1}/probe`).set(bearer(jwt));
    expect(res.status).toBe(403);
  });
  test("a non-member -> 403", async () => {
    const jwt = await mintJwt({ sub: fx.users.B1_coordinator, email: "b@example.com" });
    const res = await request(app).get(`/api/circles/${fx.circleA1}/probe`).set(bearer(jwt));
    expect(res.status).toBe(403);
  });
  test("bad :cid -> 400", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
    const res = await request(app).get(`/api/circles/not-a-uuid/probe`).set(bearer(jwt));
    expect(res.status).toBe(400);
  });
  test("no token -> 401", async () => {
    const res = await request(app).get(`/api/circles/${fx.circleA1}/probe`);
    expect(res.status).toBe(401);
  });
});
