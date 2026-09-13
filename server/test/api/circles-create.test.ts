import { beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";
import { loadFixture, type Fixture } from "../db/fixture.js";
import { mintJwt } from "../db/clients.js";
import { admin } from "../db/clients.js";

let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture();
  // A1_family has not accepted the notice; accept for one user we test the happy path with
  const c = admin(); await c.connect();
  await c.query(`update public.profiles set tos_accepted_at = now() where id = $1`, [fx.users.A2_coordinator]);
  await c.end();
});
const auth = (jwt: string) => ({ Authorization: `Bearer ${jwt}` });

test("happy path: new org + circle + coordinator membership", async () => {
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const res = await request(createApp()).post("/api/circles").set(auth(jwt)).send({
    elder_name: "Nadia", elder_lang: "ar", timezone: "America/Toronto", attestation: true,
  });
  expect(res.status).toBe(201);
  expect(res.body.circle.elder_name).toBe("Nadia");
});

test("missing attestation -> 400", async () => {
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const res = await request(createApp()).post("/api/circles").set(auth(jwt)).send({
    elder_name: "X", elder_lang: "ar", timezone: "America/Toronto",
  });
  expect(res.status).toBe(400);
});

test("invalid timezone -> 400", async () => {
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const res = await request(createApp()).post("/api/circles").set(auth(jwt)).send({
    elder_name: "X", elder_lang: "ar", timezone: "Mars/Olympus", attestation: true,
  });
  expect(res.status).toBe(400);
});

test("a valid IANA alias not in Intl.supportedValuesOf's own list is still accepted", async () => {
  // Verified empirically (node -e) before this fix: Intl.supportedValuesOf
  // ("timeZone") does not include "Asia/Kolkata" — only its older canonical
  // form "Asia/Calcutta" — even though "Asia/Kolkata" is what a real
  // browser/OS is exactly as likely to report (a genuine CLDR quirk, not a
  // typo). The literal request body's timezone check used to reject this
  // outright; canonicalizing via Intl.DateTimeFormat before the membership
  // check (both resolve to "Asia/Calcutta") fixes it.
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const res = await request(createApp()).post("/api/circles").set(auth(jwt)).send({
    elder_name: "X", elder_lang: "en", timezone: "Asia/Kolkata", attestation: true,
  });
  expect(res.status).toBe(201);
});

test("notice not accepted -> 403 notice_required", async () => {
  const jwt = await mintJwt({ sub: fx.users.A1_family, email: "f@example.com" });
  const res = await request(createApp()).post("/api/circles").set(auth(jwt)).send({
    elder_name: "X", elder_lang: "ar", timezone: "America/Toronto", attestation: true,
  });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("notice_required");
});

test("org_id you do not own -> 403", async () => {
  const jwt = await mintJwt({ sub: fx.users.A2_coordinator, email: "a2@example.com" });
  const res = await request(createApp()).post("/api/circles").set(auth(jwt)).send({
    elder_name: "X", elder_lang: "ar", timezone: "America/Toronto", attestation: true,
    org_id: fx.orgA,
  });
  expect(res.status).toBe(403);
});
