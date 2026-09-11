import { beforeAll, expect, test, vi } from "vitest";
import request from "supertest";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt, admin } from "../db/clients.js";

vi.mock("../../src/supabaseAdmin.js", () => ({
  supabaseAdmin: { auth: { admin: { inviteUserByEmail: vi.fn().mockResolvedValue({ data: {}, error: null }) } } },
}));
const { createApp } = await import("../../src/http/app.js");

let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture();
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now() where id = $1`, [fx.users.A1_coordinator]);
  await c.end();
});
const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

test("coordinator invites two people", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/invites`).set(auth(jwt))
    .send({ invites: [
      { email: " New.Person@Example.com ", role: "caregiver", is_family_member: false },
      { email: "aunt@example.com", role: "family" },
    ] });
  expect(res.status).toBe(201);
  expect(res.body.invites[0].email).toBe("new.person@example.com");
});

test("non-coordinator -> 403", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA1}/invites`).set(auth(jwt))
    .send({ invites: [{ email: "x@example.com", role: "family" }] });
  expect(res.status).toBe(403);
});

test("duplicate pending invite -> 409", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const app = createApp();
  const body = { invites: [{ email: "dup@example.com", role: "family" }] };
  await request(app).post(`/api/circles/${fx.circleA1}/invites`).set(auth(jwt)).send(body);
  const res = await request(app).post(`/api/circles/${fx.circleA1}/invites`).set(auth(jwt)).send(body);
  expect(res.status).toBe(409);
});

test("coordinator who has not accepted the notice -> 403 notice_required", async () => {
  // A2_coordinator has never accepted the notice in this fixture.
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const res = await request(createApp()).post(`/api/circles/${fx.circleA2}/invites`).set(auth(jwt))
    .send({ invites: [{ email: "x@example.com", role: "family" }] });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("notice_required");
});
