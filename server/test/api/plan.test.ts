import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

let fx: Fixture, routineId: string;
beforeAll(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now() where id = any($1)`,
    [[fx.users.A1_coordinator, fx.users.A1_caregiver_hired, fx.users.A1_family]]);
  routineId = (await c.query(
    `insert into public.routine_items (circle_id, title, time_of_day, weekdays, effective_from)
     values ($1,'Morning meds','08:00','{0,1,2,3,4,5,6}','2026-01-01') returning id`,
    [fx.circleA1])).rows[0].id;
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

test("caregiver toggles a routine task done, family sees it", async () => {
  const app = createApp();
  const cg = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const t = await request(app).post(`/api/circles/${fx.circleA1}/plan/toggle`).set(auth(cg))
    .send({ date: "2026-09-08", key: `r:${routineId}`, done: true, note: "taken" });
  expect(t.status).toBe(200);
  const done = t.body.tasks.find((x: any) => x.key === `r:${routineId}`);
  expect(done.doneByName).toContain("caregiver");

  const fam = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const view = await request(app).get(`/api/circles/${fx.circleA1}/plan?date=2026-09-08`).set(auth(fam));
  expect(view.body.tasks.find((x: any) => x.key === `r:${routineId}`).doneAt).not.toBeNull();
});

test("family cannot toggle -> 403", async () => {
  const fam = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/plan/toggle`).set(auth(fam))
    .send({ date: "2026-09-08", key: `r:${routineId}`, done: true });
  expect(res.status).toBe(403);
});
