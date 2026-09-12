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

test("removing the org owner -> 409 (owner branch, not the coordinator-count branch)", async () => {
  // A1_coordinator is BOTH orgA's owner and circleA1's sole coordinator, so
  // this trips guard_member_removal's owner check first (it runs before the
  // coordinator-count check) — asserted on the message so a future test
  // regression can't silently start exercising the other branch instead.
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp())
    .delete(`/api/circles/${fx.circleA1}/members/${fx.users.A1_coordinator}`).set(auth(jwt));
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/organization owner/i);
});

test("removing the last coordinator who is NOT the owner -> 409 (coordinator-count branch)", async () => {
  // circleA2 has two coordinators (A2_coordinator, twoCircle); orgA's owner
  // is A1_coordinator, who is not even a member of circleA2 — so neither
  // removal here can trip the owner branch. Drop to one coordinator, then
  // remove that last one to hit the coordinator-count branch specifically.
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const app = createApp();
  const first = await request(app)
    .delete(`/api/circles/${fx.circleA2}/members/${fx.users.twoCircle}`).set(auth(jwt));
  expect(first.status).toBe(204);

  const second = await request(app)
    .delete(`/api/circles/${fx.circleA2}/members/${fx.users.A2_coordinator}`).set(auth(jwt));
  expect(second.status).toBe(409);
  expect(second.body.error).toMatch(/last coordinator/i);
});

test("a non-member cannot delete", async () => {
  const jwt = await mintJwt({ sub: fx.users.B1_coordinator, email: "b@example.com" });
  const res = await request(createApp()).delete(`/api/circles/${fx.circleA1}`).set(auth(jwt));
  expect(res.status).toBe(403);
});
