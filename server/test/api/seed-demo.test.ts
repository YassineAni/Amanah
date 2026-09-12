import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { admin, ADMIN_URL, APP_URL, API_URL, JWT_SECRET_STRING } from "../db/clients.js";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../");

test("seed:demo builds an is_demo circle with content", async () => {
  const c = admin(); await c.connect();
  const email = `demo-owner-${randomUUID().slice(0, 8)}@example.com`;
  await c.query(
    `insert into auth.users (id,instance_id,aud,role,email,encrypted_password,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
     values (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'',now(),now(),'{}','{}')`,
    [email]);

  // Explicit local env, not just NODE_ENV=test: this is a spawned child
  // process, so it does NOT go through vitest's setupFiles (test/setup-env.ts)
  // that injects the correct winnat-remapped ports for the parent process.
  // Left to its own test defaults, src/config.ts would resolve
  // DATABASE_URL_ADMIN to the Supabase-default port (54322), not this
  // machine's 54122 — same class of issue Task 1 solved for the test
  // runner itself, but that fix doesn't reach a child process.
  //
  // On Windows, execFileSync cannot spawn "npx" (ENOENT) nor "npx.cmd"
  // (EINVAL, Node's .cmd-without-shell guard) as an argv array — run it
  // through a shell as a single fixed command string instead (no arg array
  // -> no DEP0190 warning either). Same pattern already established in
  // test/db/bypass.test.ts and test/db/clients.ts (execSync "npx supabase
  // status"). `email` is test-generated (fixed prefix + randomUUID hex),
  // never user input, so string interpolation into the shell command is
  // safe here.
  execFileSync(`npx tsx scripts/seed-demo.ts --owner-email ${email}`, {
    cwd: serverRoot,
    stdio: "pipe",
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: APP_URL,
      DATABASE_URL_ADMIN: ADMIN_URL,
      SUPABASE_URL: API_URL,
      SUPABASE_JWT_SECRET: JWT_SECRET_STRING,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "test-service-role-key",
    },
  });

  const r = await c.query(
    `select count(*)::int n from public.checkin_content cc
     join public.circles ci on ci.id = cc.circle_id
     join public.organizations o on o.id = ci.org_id
     where o.is_demo and o.owner_user_id = (select id from public.profiles where email = $1)`,
    [email]);
  expect(r.rows[0].n).toBeGreaterThanOrEqual(6);
  await c.end();
});
