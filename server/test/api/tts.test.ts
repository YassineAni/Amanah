import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt } from "../db/clients.js";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

test("no token -> 401", async () => {
  const res = await request(createApp()).post("/api/tts").send({ text: "hello" });
  expect(res.status).toBe(401);
});

test("over the per-user limit -> 429", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_elder, email: "e@example.com" });
  const app = createApp();
  let last = 0;
  for (let i = 0; i < 62; i++) {
    last = (await request(app).post("/api/tts").set("Authorization", `Bearer ${jwt}`)
      .send({ text: `line ${i}` })).status;
  }
  expect(last).toBe(429);
});
