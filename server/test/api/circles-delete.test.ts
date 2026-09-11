import { beforeEach, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

let fx: Fixture;
beforeEach(async () => { fx = await loadFixture(); });
const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

test("owner-coordinator deletes the circle -> 204, rows gone", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).delete(`/api/circles/${fx.circleA1}`).set(auth(jwt));
  expect(res.status).toBe(204);
  const c = admin(); await c.connect();
  const left = await c.query(`select 1 from public.circles where id = $1`, [fx.circleA1]);
  expect(left.rowCount).toBe(0);
  await c.end();
});

test("removing the last coordinator -> 409", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp())
    .delete(`/api/circles/${fx.circleA1}/members/${fx.users.A1_coordinator}`).set(auth(jwt));
  expect(res.status).toBe(409);
});

test("a non-member cannot delete", async () => {
  const jwt = await mintJwt({ sub: fx.users.B1_coordinator, email: "b@example.com" });
  const res = await request(createApp()).delete(`/api/circles/${fx.circleA1}`).set(auth(jwt));
  expect(res.status).toBe(403);
});
