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

  const { supabaseAdmin } = await import("../../src/supabaseAdmin.js");
  expect(supabaseAdmin.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
    "new.person@example.com",
    expect.objectContaining({
      data: { circle_id: fx.circleA1, role: "caregiver", is_family_member: false },
      redirectTo: expect.stringContaining("/invite/"),
    }),
  );
});

test("a duplicate mid-batch rolls back the WHOLE batch (no stranded row/email)", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "c@example.com" });
  const app = createApp();
  // pre-seed a pending invite for the second email so the batch conflicts on item 2
  await request(app).post(`/api/circles/${fx.circleA1}/invites`).set(auth(jwt))
    .send({ invites: [{ email: "already-pending@example.com", role: "family" }] });

  const { supabaseAdmin } = await import("../../src/supabaseAdmin.js");
  vi.mocked(supabaseAdmin.auth.admin.inviteUserByEmail).mockClear();

  const res = await request(app).post(`/api/circles/${fx.circleA1}/invites`).set(auth(jwt)).send({
    invites: [
      { email: "brand-new@example.com", role: "family" },
      { email: "already-pending@example.com", role: "family" },
    ],
  });
  expect(res.status).toBe(409);
  // no email should have been sent for either item — the whole txn rolled back
  expect(supabaseAdmin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();

  const c = admin(); await c.connect();
  const stranded = await c.query(`select 1 from public.invites where email = 'brand-new@example.com'`);
  expect(stranded.rowCount).toBe(0);
  await c.end();
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
