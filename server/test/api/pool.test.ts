import { describe, expect, test } from "vitest";
import { withUserTxn } from "../../src/db/pool.js";

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
});
