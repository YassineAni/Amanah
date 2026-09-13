import { beforeEach, expect, test } from "vitest";
import { Client } from "pg";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin, APP_URL } from "../db/clients.js";
import { logAudit } from "../../src/audit.js";
import { uploadStaging, promoteStaging, deleteCircleAudio } from "../../src/storage/audio.js";

let fx: Fixture;
beforeEach(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`delete from public.audit_log`); // isolate each test's assertions
  await c.query(`update public.profiles set tos_accepted_at = now() where id = any($1)`,
    [[fx.users.A1_coordinator, fx.users.A1_elder, fx.users.A1_caregiver_hired]]);
  await c.end();
});
const auth = (j: string) => ({ Authorization: `Bearer ${j}` });

async function rows(): Promise<any[]> {
  const c = admin(); await c.connect();
  try {
    return (await c.query(`select * from public.audit_log order by occurred_at`)).rows;
  } finally {
    await c.end();
  }
}

// --- RLS lockdown: the whole point of this table is that the normal app
// connection can never read or write it, only adminPool (BYPASSRLS). ---

// Deliberately a real connection as the actual app_authenticated role
// (APP_URL), not SET ROLE from the admin connection — verified directly
// (docker exec psql) that SET ROLE app_authenticated from the admin role
// fails LOUDLY here ("permission denied to set role", since that role
// membership was granted with inherit_option=false/set_option=false), not
// silently — but a careless `try { SET ROLE ... } catch {}` around it
// would swallow that error and go on to run these assertions as the
// still-BYPASSRLS admin connection, producing a false pass on every one
// of them. A real login sidesteps the whole question.
test("app_authenticated cannot SELECT/INSERT/UPDATE/DELETE audit_log under any verb", async () => {
  const c = admin(); await c.connect();
  const seeded = await c.query(
    `insert into public.audit_log (actor_id, action) values ($1, 'test') returning id`,
    [fx.users.A1_coordinator],
  );
  await c.end();
  const seededId = seeded.rows[0].id;

  const appC = new Client({ connectionString: APP_URL });
  await appC.connect();
  try {
    await appC.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: fx.users.A1_coordinator, role: "authenticated" })]);

    // The migration's explicit `revoke all ... from app_authenticated`
    // means Postgres denies every verb at the PRIVILEGE layer, before RLS
    // is even consulted — "permission denied for table audit_log", not
    // "0 rows" or an RLS-specific message. This is the stronger of the two
    // outcomes the two independent layers (grants + RLS) could produce;
    // pinning it here means a regression in either layer alone would still
    // be caught by one of these four assertions.
    await expect(appC.query("select count(*) from public.audit_log")).rejects.toThrow(/permission denied/i);
    await expect(
      appC.query("insert into public.audit_log (actor_id, action) values ($1, 'test')", [fx.users.A1_coordinator]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      appC.query("update public.audit_log set action = 'tampered' where id = $1", [seededId]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      appC.query("delete from public.audit_log where id = $1", [seededId]),
    ).rejects.toThrow(/permission denied/i);
  } finally {
    await appC.end();
  }

  // Confirm from the admin side that the seeded row is genuinely
  // untouched — the four rejections above prove the queries never ran,
  // but this closes the loop with a direct read of the actual row.
  const c2 = admin(); await c2.connect();
  const still = await c2.query("select action from public.audit_log where id = $1", [seededId]);
  expect(still.rows[0]?.action).toBe("test");
  await c2.end();
});

// --- logAudit() itself ---

test("logAudit writes a row via adminPool", async () => {
  await logAudit(fx.users.A1_coordinator, "checkin_audio_access", {
    circleId: fx.circleA1, targetId: "11111111-1111-1111-1111-111111111111", metadata: { via: "unit-test" },
  });
  const r = await rows();
  expect(r).toHaveLength(1);
  expect(r[0].action).toBe("checkin_audio_access");
  expect(r[0].actor_id).toBe(fx.users.A1_coordinator);
  expect(r[0].circle_id).toBe(fx.circleA1);
  expect(r[0].metadata).toEqual({ via: "unit-test" });
});

// --- integration: each instrumented route actually logs ---

test("GET /checkins logs checkins_list_access with the actual returned checkin ids", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).get(`/api/circles/${fx.circleA1}/checkins`).set(auth(jwt));
  expect(res.status).toBe(200);
  const r = await rows();
  const entry = r.find((x) => x.action === "checkins_list_access");
  expect(entry).toBeTruthy();
  expect(entry.actor_id).toBe(fx.users.A1_coordinator);
  expect(entry.circle_id).toBe(fx.circleA1);
  expect(entry.metadata.checkinIds.sort()).toEqual(res.body.map((c: any) => c.id).sort());
});

test("GET /checkins/:id/audio logs checkin_audio_access only on a successful signed-URL issuance", async () => {
  // A1_elder_self checkin (visibility 'family', recorded by the elder
  // herself, no real audio_path) has no audio — this call should 403
  // before ever reaching the audit-log line, since that's specifically
  // placed after signedUrl() succeeds, not on every request to the route.
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp())
    .get(`/api/circles/${fx.circleA1}/checkins/${fx.checkins.A1_elder_self}/audio`).set(auth(jwt));
  expect(res.status).toBe(403); // no audio_path on this fixture checkin
  const r = await rows();
  expect(r.find((x) => x.action === "checkin_audio_access")).toBeUndefined();
});

test("GET /checkins/:id/audio logs checkin_audio_access when the signed URL genuinely issues", async () => {
  // Real Storage round-trip (not a fake audio_path string) — signedUrl()
  // would itself fail against a nonexistent object, so this needs a real
  // promoted object for the "success" path to be genuine.
  const staging = await uploadStaging(fx.circleA1, Buffer.from("fake-audio"), "webm");
  const promoted = await promoteStaging(staging);
  const c = admin(); await c.connect();
  await c.query(`update public.checkin_content set audio_path = $1 where checkin_id = $2`,
    [promoted, fx.checkins.A1_circle]);
  await c.end();

  try {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
    const res = await request(createApp())
      .get(`/api/circles/${fx.circleA1}/checkins/${fx.checkins.A1_circle}/audio`).set(auth(jwt));
    expect(res.status).toBe(200);
    expect(res.body.url).toContain("token=");
    const r = await rows();
    const entry = r.find((x) => x.action === "checkin_audio_access");
    expect(entry).toBeTruthy();
    expect(entry.actor_id).toBe(fx.users.A1_coordinator);
    expect(entry.target_id).toBe(fx.checkins.A1_circle);
  } finally {
    await deleteCircleAudio(fx.circleA1);
  }
});

test("DELETE /checkins/:id logs checkin_delete", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp())
    .delete(`/api/circles/${fx.circleA1}/checkins/${fx.checkins.A1_circle}`).set(auth(jwt));
  expect(res.status).toBe(204);
  const r = await rows();
  const entry = r.find((x) => x.action === "checkin_delete");
  expect(entry).toBeTruthy();
  expect(entry.target_id).toBe(fx.checkins.A1_circle);
  expect(entry.circle_id).toBe(fx.circleA1);
});

test("DELETE /circles/:cid/members/:userId logs member_remove", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp())
    .delete(`/api/circles/${fx.circleA1}/members/${fx.users.A1_caregiver_hired}`).set(auth(jwt));
  expect(res.status).toBe(204);
  const r = await rows();
  const entry = r.find((x) => x.action === "member_remove");
  expect(entry).toBeTruthy();
  expect(entry.target_id).toBe(fx.users.A1_caregiver_hired);
});

test("DELETE /circles/:cid logs circle_delete — and the record survives the circle being gone", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).delete(`/api/circles/${fx.circleA1}`).set(auth(jwt));
  expect(res.status).toBe(204);
  const r = await rows();
  const entry = r.find((x) => x.action === "circle_delete");
  expect(entry).toBeTruthy();
  expect(entry.circle_id).toBe(fx.circleA1); // no FK — this reference outlives the deleted circle

  const c = admin(); await c.connect();
  const stillThere = await c.query(`select 1 from public.circles where id = $1`, [fx.circleA1]);
  expect(stillThere.rowCount).toBe(0); // circle really is gone
  await c.end();
});
