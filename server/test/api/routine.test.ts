import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now() where id = $1`, [fx.users.A1_coordinator]);
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

test("PATCH archives the old item and creates a forward-dated replacement", async () => {
  const app = createApp();
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const created = await request(app).post(`/api/circles/${fx.circleA1}/routine`).set(auth(jwt))
    .send({ title: "Walk", time: "10:00", weekdays: [1, 3, 5] });
  const patched = await request(app).patch(`/api/circles/${fx.circleA1}/routine/${created.body.id}`)
    .set(auth(jwt)).send({ time: "11:00" });
  expect(patched.status).toBe(200);
  expect(patched.body.id).not.toBe(created.body.id);      // new row
  expect(patched.body.time_of_day).toBe("11:00:00");

  const list = await request(app).get(`/api/circles/${fx.circleA1}/routine`).set(auth(jwt));
  const ids = list.body.map((r: any) => r.id);
  expect(ids).toContain(patched.body.id);
  expect(ids).not.toContain(created.body.id);              // old one archived
});

test("non-coordinator cannot touch the routine", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/routine`).set(auth(jwt));
  expect(res.status).toBe(403);
});
