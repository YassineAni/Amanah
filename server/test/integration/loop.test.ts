import { beforeEach, expect, test, vi } from "vitest";
import request from "supertest";
import { admin, mintJwt } from "../db/clients.js";
import { randomUUID } from "node:crypto";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ error: null }) } } },
}));
vi.mock("../../src/storage/audio.js", () => ({
  uploadStaging: vi.fn(async (cid: string) => `${cid}/staging/x.webm`),
  promoteStaging: vi.fn(async (p: string) => p.replace("/staging/", "/")),
  signedUrl: vi.fn(async () => "https://signed/x"),
  deleteCircleAudio: vi.fn(async () => {}),
}));
const { createApp } = await import("../../src/http/app.js");

async function newUser(email: string): Promise<string> {
  const c = admin(); await c.connect();
  const id = randomUUID();
  // jsonb_build_object is variadic/polymorphic, so pg can't infer $3's type
  // from context alone ("could not determine data type of parameter $3") —
  // needs an explicit cast.
  await c.query(
    `insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
     values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'',now(),now(),'{}', jsonb_build_object('full_name',$3::text))`,
    [id, email, email.split("@")[0]]);
  await c.end();
  return id;
}

beforeEach(async () => {
  const c = admin(); await c.connect();
  await c.query(`truncate table public.checkin_content, public.checkins, public.shifts,
    public.completions, public.adhoc_tasks, public.routine_items, public.invites,
    public.circle_members, public.circles, public.organizations restart identity cascade`);
  await c.query(`delete from auth.users where email like '%@loop.test'`);
  await c.end();
});

test("onboarding -> invite -> proxy check-in -> care-signal -> toggle -> family view -> delete", async () => {
  const app = createApp();
  const coordId = await newUser("coord@loop.test");
  const familyId = await newUser("fam@loop.test");
  const coord = await mintJwt({ sub: coordId, email: "coord@loop.test" });
  const fam = await mintJwt({ sub: familyId, email: "fam@loop.test" });

  // accept notice
  await request(app).post("/api/me/accept-notice").set("Authorization", `Bearer ${coord}`)
    .send({ version: "2026-09-08" }).expect(204);
  await request(app).post("/api/me/accept-notice").set("Authorization", `Bearer ${fam}`)
    .send({ version: "2026-09-08" }).expect(204);

  // create circle
  const circle = (await request(app).post("/api/circles").set("Authorization", `Bearer ${coord}`)
    .send({ elder_name: "Amina", elder_lang: "ar", timezone: "America/Toronto", attestation: true })
    .expect(201)).body.circle;

  // invite the family member + accept
  const c = admin(); await c.connect();
  const token = (randomUUID() + randomUUID()).replace(/-/g, "");
  await c.query(
    `insert into public.invites (circle_id,email,role,is_family_member,token,invited_by)
     values ($1,'fam@loop.test','family',true,$2,$3)`, [circle.id, token, coordId]);
  await c.end();
  await request(app).post(`/api/invites/${token}/accept`).set("Authorization", `Bearer ${fam}`)
    .send({}).expect(200);

  // coordinator records a proxy check-in
  await request(app).post(`/api/circles/${circle.id}/checkins`).set("Authorization", `Bearer ${coord}`)
    .send({ mood: "hard", transcript: "tough night", visibility: "family" }).expect(201);

  // coordinator sees it on the care-signal
  const cs = await request(app).get(`/api/circles/${circle.id}/care-signal`)
    .set("Authorization", `Bearer ${coord}`).expect(200);
  expect(cs.body.days.some((d: any) => d.mood === "hard")).toBe(true);

  // routine + toggle
  const routine = (await request(app).post(`/api/circles/${circle.id}/routine`)
    .set("Authorization", `Bearer ${coord}`)
    .send({ title: "Meds", time: "08:00", weekdays: [0,1,2,3,4,5,6] }).expect(201)).body;
  const today = cs.body.window[6];
  await request(app).post(`/api/circles/${circle.id}/plan/toggle`).set("Authorization", `Bearer ${coord}`)
    .send({ date: today, key: `r:${routine.id}`, done: true }).expect(200);

  // family read-only sees the completion
  const plan = await request(app).get(`/api/circles/${circle.id}/plan?date=${today}`)
    .set("Authorization", `Bearer ${fam}`).expect(200);
  expect(plan.body.tasks.find((t: any) => t.key === `r:${routine.id}`).doneAt).not.toBeNull();

  // delete the circle
  await request(app).delete(`/api/circles/${circle.id}`).set("Authorization", `Bearer ${coord}`).expect(204);
  const c2 = admin(); await c2.connect();
  expect((await c2.query(`select 1 from public.circles where id=$1`, [circle.id])).rowCount).toBe(0);
  await c2.end();
});
