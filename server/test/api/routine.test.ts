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

test("edits apply forward: a past date keeps the pre-edit title + its completion; today shows the new one", async () => {
  // This is the test that would have caught the Task 18-19 review's
  // Critical finding (archived_at read as a JS Date, not text, crashing
  // GET /plan with a 500 for every date on any circle with an archived
  // routine item) — the earlier PATCH test never called GET /plan at all.
  const app = createApp();
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const pastDate = "2026-08-01";

  const created = await request(app).post(`/api/circles/${fx.circleA1}/routine`).set(auth(jwt))
    .send({ title: "Old Meds", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] });
  expect(created.status).toBe(201);
  // Backdate effective_from to simulate a long-lived item (the API always
  // creates with today's date; a real routine item predates most edits).
  const c = admin(); await c.connect();
  await c.query(`update public.routine_items set effective_from = '2026-01-01' where id = $1`,
    [created.body.id]);
  await c.end();

  const toggle = await request(app).post(`/api/circles/${fx.circleA1}/plan/toggle`).set(auth(jwt))
    .send({ date: pastDate, key: `r:${created.body.id}`, done: true, note: "done back then" });
  expect(toggle.status).toBe(200);

  const patched = await request(app).patch(`/api/circles/${fx.circleA1}/routine/${created.body.id}`)
    .set(auth(jwt)).send({ title: "New Meds", time: "10:00" });
  expect(patched.status).toBe(200);

  const past = await request(app).get(`/api/circles/${fx.circleA1}/plan?date=${pastDate}`).set(auth(jwt));
  expect(past.status).toBe(200); // must not 500
  const pastTask = past.body.tasks.find((t: any) => t.title === "Old Meds" || t.title === "New Meds");
  expect(pastTask?.title).toBe("Old Meds");
  expect(pastTask?.doneAt).not.toBeNull(); // the completion survives the edit

  const today = await request(app).get(`/api/circles/${fx.circleA1}/plan`).set(auth(jwt));
  expect(today.status).toBe(200);
  const todayTask = today.body.tasks.find((t: any) => t.title === "Old Meds" || t.title === "New Meds");
  expect(todayTask?.title).toBe("New Meds");
});

test("toggling a routine item on a date it isn't active for -> 404", async () => {
  const app = createApp();
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const created = await request(app).post(`/api/circles/${fx.circleA1}/routine`).set(auth(jwt))
    .send({ title: "Future Item", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] });
  const res = await request(app).post(`/api/circles/${fx.circleA1}/plan/toggle`).set(auth(jwt))
    .send({ date: "2020-01-01", key: `r:${created.body.id}`, done: true }); // before effective_from
  expect(res.status).toBe(404);
});

test("non-coordinator cannot touch the routine", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_caregiver_hired, email: "h@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/routine`).set(auth(jwt));
  expect(res.status).toBe(403);
});
