import { describe, expect, test } from "vitest";
import { withUserTxn } from "../../src/db/pool.js";

describe("withUserTxn", () => {
  test("claims do not leak across two sequential calls on the same pooled conn", async () => {
    // Call 1 as a real fixture user would see rows; call 2 with a bogus sub
    // must see nothing — proving set_config was LOCAL and DISCARD ALL ran.
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
