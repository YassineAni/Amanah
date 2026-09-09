import { beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { loadFixture, type Fixture } from "./fixture";
import { rawNoClaims, mintJwt, postgrest } from "./clients";
import { Client } from "pg";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

describe("connection-level claims are not sticky", () => {
  test("set claims in a txn, DISCARD ALL, next txn sees nothing", async () => {
    const c = new Client({
      connectionString:
        "postgresql://app_authenticated:app_authenticated@127.0.0.1:54122/postgres",
    });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ sub: fx.users.A1_coordinator, role: "authenticated" }),
      ]);
      const seen = await c.query("select count(*)::int n from public.circles");
      expect(seen.rows[0].n).toBeGreaterThan(0);
      await c.query("commit");
      await c.query("discard all");
      // fresh txn, no claims -> auth.uid() null -> zero rows
      const after = await c.query("select count(*)::int n from public.circles");
      expect(after.rows[0].n).toBe(0);
    } finally { await c.end(); }
  });
});

describe("the browser cannot reach data through PostgREST", () => {
  test("anon key + a valid user JWT against /rest/v1/checkins -> 0 rows or 404", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "A1_coordinator@example.com" });
    const res = await postgrest("/rest/v1/checkins?select=*", jwt);
    // schema not exposed -> 404; or exposed-but-revoked -> 200 [] ; never data
    if (res.status === 200) {
      expect(await res.json()).toEqual([]);
    } else {
      expect([401, 403, 404]).toContain(res.status);
    }
  });

  test("same for checkin_content and circle_members", async () => {
    const jwt = await mintJwt({ sub: fx.users.A1_coordinator, email: "x@example.com" });
    for (const t of ["checkin_content", "circle_members"]) {
      const res = await postgrest(`/rest/v1/${t}?select=*`, jwt);
      if (res.status === 200) expect(await res.json()).toEqual([]);
      else expect([401, 403, 404]).toContain(res.status);
    }
  });
});

describe("migrations are idempotent", () => {
  // db reset re-applies every migration; two runs prove no migration breaks on
  // a non-empty DB. Each run is ~15-30s, so this test needs a longer timeout.
  test("db reset twice in a row succeeds", () => {
    // Deviation from brief: on Windows, execFileSync cannot spawn "npx"
    // (ENOENT) nor "npx.cmd" (EINVAL, Node's .cmd-without-shell guard), so
    // run it through a shell as a single fixed command string (no arg array
    // -> no DEP0190). Same pattern as clients.ts (execSync "npx supabase
    // status"). Intent unchanged: run `supabase db reset` twice, both succeed.
    execFileSync("npx supabase db reset", { stdio: "pipe", shell: true });
    execFileSync("npx supabase db reset", { stdio: "pipe", shell: true });
  }, 180_000);
});
