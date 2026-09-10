import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser, rawNoClaims } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

describe("tenant SELECT isolation", () => {
  // The fixture seeds check-ins in circleA1, circleA2 AND circleB1, so
  // `every(row is mine)` is now falsifiable: with RLS off each viewer would
  // see the other circles' rows. (It previously passed with RLS disabled,
  // because only circleA1 had any check-ins at all.)
  test("a member sees rows for their circle only", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("select circle_id from public.checkins"),
    );
    expect(r.rowCount).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.circle_id === fx.circleA1)).toBe(true);
    // named explicitly: the other tenant's rows exist and must not appear
    expect(r.rows.some((x) => x.circle_id === fx.circleB1)).toBe(false);
    expect(r.rows.some((x) => x.circle_id === fx.circleA2)).toBe(false);
  });

  test("a second viewer sees only THEIR circle's check-ins (same rows, other side)", async () => {
    const r = await asUser(fx.users.A2_coordinator, (c) =>
      c.query("select circle_id from public.checkins"),
    );
    expect(r.rowCount).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.circle_id === fx.circleA2)).toBe(true);
    expect(r.rows.some((x) => x.circle_id === fx.circleA1)).toBe(false);
    expect(r.rows.some((x) => x.circle_id === fx.circleB1)).toBe(false);
  });

  test("a cross-circle viewer cannot read another circle's `circle`-tier content", async () => {
    // the marquee "reads another circle's data" case: circle-tier is the most
    // permissive tier there is, and it still stops at the circle boundary.
    const r = await asUser(fx.users.B1_coordinator, (c) =>
      c.query("select checkin_id from public.checkin_content where checkin_id = $1",
        [fx.checkins.A1_circle]),
    );
    expect(r.rowCount).toBe(0);
  });

  test("a plain member cannot read a pending invite's token or email", async () => {
    // sel_invites is coordinator-only: the row carries the bearer token.
    const asFamily = await asUser(fx.users.A1_family, (c) =>
      c.query("select token, email from public.invites where circle_id = $1", [fx.circleA1]));
    expect(asFamily.rowCount).toBe(0);
    const asCoordinator = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("select token, email from public.invites where circle_id = $1", [fx.circleA1]));
    expect(asCoordinator.rowCount).toBe(1);
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
