import { describe, expect, test } from "vitest";
import { withUserTxn, appPool } from "../../src/db/pool.js";
import { admin } from "../db/clients.js";

describe("withUserTxn", () => {
  test("a bogus sub sees zero rows via RLS (set_config actually reaches the query)", async () => {
    // This proves withUserTxn's set_config is wired to a real RLS-gated
    // read, not that it's LOCAL / non-sticky across pooled connections —
    // that stronger property is proven separately by test/db/bypass.test.ts
    // (DISCARD ALL on a raw client).
    const bogus = "00000000-0000-0000-0000-000000000000";
    const n = await withUserTxn(
      { sub: bogus, email: "x@example.com", role: "authenticated" },
      (q) => q.query("select count(*)::int n from public.circles"),
    );
    expect(n.rows[0].n).toBe(0);
  });

  test("binds claims as a parameter (a quote in the email cannot break out)", async () => {
    await expect(
      withUserTxn(
        { sub: "11111111-1111-1111-1111-111111111111", email: "a'b\"c@example.com", role: "authenticated" },
        (q) => q.query("select 1 as ok"),
      ),
    ).resolves.toBeDefined();
  });

  test("an idle pooled connection killed server-side does not crash the process", async () => {
    // Regression guard for a real CI failure: appPool had no 'error'
    // listener, so when bypass.test.ts's migration-idempotency check
    // restarts Postgres mid-suite (`supabase db reset`, twice), any
    // connection another test had left idle in the pool gets killed
    // server-side — an unhandled 'error' event on the Pool, which crashes
    // the whole process (not just one request). All 164 tests passed in
    // that CI run; the job still failed (exit code 1) because of this.
    //
    // Reproduce the same failure mode directly, without a 60s db reset:
    // put a connection in the pool's idle list, kill its backend PID from
    // an admin connection, then prove the pool is still usable afterwards
    // — if the 'error' listener in pool.ts were missing, this test would
    // never reach that assertion; the process would go down first.
    const victim = await appPool.connect();
    const pid: number = (await victim.query("select pg_backend_pid() as pid")).rows[0].pid;
    victim.release();

    const a = admin();
    await a.connect();
    await a.query("select pg_terminate_backend($1)", [pid]);
    await a.end();

    // give the pool a moment to receive the dead socket's 'error' event
    await new Promise((r) => setTimeout(r, 300));

    const n = await withUserTxn(
      { sub: "00000000-0000-0000-0000-000000000000", email: "x@example.com", role: "authenticated" },
      (q) => q.query("select 1 as ok"),
    );
    expect(n.rows[0].ok).toBe(1);
  });
});
