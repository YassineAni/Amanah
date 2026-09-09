import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser, rawNoClaims } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

describe("tenant SELECT isolation", () => {
  test("a member sees rows for their circle only", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("select circle_id from public.checkins"),
    );
    expect(r.rows.every((x) => x.circle_id === fx.circleA1)).toBe(true);
    expect(r.rowCount).toBeGreaterThan(0);
  });

  test("an org-A member sees nothing in an org-B circle", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("select * from public.circles where id = $1", [fx.circleB1]),
    );
    expect(r.rowCount).toBe(0);
  });

  test("the two-circle viewer sees BOTH circles via RLS (scope is per-membership)", async () => {
    const r = await asUser(fx.users.twoCircle, (c) =>
      c.query("select id from public.circles order by name"),
    );
    expect(r.rows.map((x) => x.id).sort()).toEqual([fx.circleA2, fx.circleB1].sort());
  });

  test("no claims set -> zero rows on every tenant table", async () => {
    const c = await rawNoClaims();
    try {
      for (const t of ["profiles","organizations","circles","circle_members",
        "invites","checkins","checkin_content","shifts","routine_items",
        "completions","adhoc_tasks"]) {
        const r = await c.query(`select * from public.${t}`);
        expect(r.rowCount, t).toBe(0);
      }
    } finally { await c.end(); }
  });

  // (a soft-removed member seeing nothing is exercised with a committed
  // removal in write-matrix.test.ts — it cannot be observed inside asUser's
  // rolled-back transaction.)
});
