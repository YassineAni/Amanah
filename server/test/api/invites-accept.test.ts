import { beforeEach, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";
import { randomUUID } from "node:crypto";

let fx: Fixture;
async function seedInvite(circle: string, email: string, role = "family", token = randomUUID().replace(/-/g,"")) {
  const c = admin(); await c.connect();
  await c.query(
    `insert into public.invites (circle_id,email,role,is_family_member,token,invited_by)
     values ($1,$2,$3,true,$4,$5)`,
    [circle, email, role, token, fx.users.A1_coordinator],
  );
  await c.end();
  return token;
}
beforeEach(async () => { fx = await loadFixture(); });

test("GET preview has no email field", async () => {
  const token = await seedInvite(fx.circleA1, "preview@example.com");
  const res = await request(createApp()).get(`/api/invites/${token}`);
  expect(res.status).toBe(200);
  expect(res.body).not.toHaveProperty("email");
  expect(res.body.role).toBe("family");
});

test("a non-member accepts and joins the circle", async () => {
  // A2_coordinator is not a member of B1
  const token = await seedInvite(fx.circleB1, "A2_coordinator@example.com", "caregiver");
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "A2_coordinator@example.com" });
  const res = await request(createApp()).post(`/api/invites/${token}/accept`)
    .set("Authorization", `Bearer ${jwt}`).send({});
  expect(res.status).toBe(200);
  expect(res.body.circle_id).toBe(fx.circleB1);
});

test("accept when already an active member -> 409", async () => {
  // twoCircle is already family in B1
  const token = await seedInvite(fx.circleB1, "twoCircle@example.com", "caregiver");
  const jwt = await mintJwt({ sub: fx.users.twoCircle, email: "twoCircle@example.com" });
  const res = await request(createApp()).post(`/api/invites/${token}/accept`)
    .set("Authorization", `Bearer ${jwt}`).send({});
  expect(res.status).toBe(409);
});

test("accept with a different email -> 403", async () => {
  const token = await seedInvite(fx.circleA1, "someone.else@example.com");
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).post(`/api/invites/${token}/accept`)
    .set("Authorization", `Bearer ${jwt}`).send({});
  expect(res.status).toBe(403);
});

test("double-accept: second call -> 410", async () => {
  const token = await seedInvite(fx.circleB1, "A2_coordinator@example.com");
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "A2_coordinator@example.com" });
  const app = createApp();
  const a = await request(app).post(`/api/invites/${token}/accept`).set("Authorization", `Bearer ${jwt}`).send({});
  const b = await request(app).post(`/api/invites/${token}/accept`).set("Authorization", `Bearer ${jwt}`).send({});
  expect(a.status).toBe(200);
  expect(b.status).toBe(410);
});

test("re-invite of a soft-removed member: accept un-removes them", async () => {
  // remove A2_coordinator from B1 first (they were added by an earlier test in a
  // fresh fixture this won't exist — so add+remove here), then re-invite.
  const c = admin(); await c.connect();
  await c.query(
    `insert into public.circle_members (circle_id,user_id,role,is_family_member,removed_at)
     values ($1,$2,'family',true, now())`, [fx.circleB1, fx.users.A2_coordinator]);
  await c.end();
  const token = await seedInvite(fx.circleB1, "A2_coordinator@example.com", "caregiver");
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "A2_coordinator@example.com" });
  const res = await request(createApp()).post(`/api/invites/${token}/accept`)
    .set("Authorization", `Bearer ${jwt}`).send({});
  expect(res.status).toBe(200);
  const c2 = admin(); await c2.connect();
  const m = await c2.query(
    `select role, removed_at from public.circle_members where circle_id=$1 and user_id=$2`,
    [fx.circleB1, fx.users.A2_coordinator]);
  expect(m.rows[0].removed_at).toBeNull();
  expect(m.rows[0].role).toBe("caregiver");
  await c2.end();
});
