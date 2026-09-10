import { beforeEach, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { admin, asUser } from "./clients";
import type { Client } from "pg";

let fx: Fixture;
// beforeEach: these tests commit a soft-removal via the admin pool.
beforeEach(async () => { fx = await loadFixture(); });

async function withAdmin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = admin();
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

/** Soft-remove `userId` from `circle` on the admin pool (BYPASSRLS), the way
 *  the real "revoke access" endpoint will. A1_coordinator is orgA's OWNER and
 *  the guard refuses to remove an owner, so ownership is handed to `newOwner`
 *  first — otherwise the removal we are testing cannot be staged at all. */
async function softRemove(userId: string, circle: string, opts: {
  org?: string; newOwner?: string; secondCoordinator?: string;
} = {}) {
  await withAdmin(async (c) => {
    if (opts.org && opts.newOwner) {
      await c.query(`update public.organizations set owner_user_id=$1 where id=$2`,
        [opts.newOwner, opts.org]);
    }
    if (opts.secondCoordinator) {
      await c.query(
        `insert into public.circle_members (circle_id,user_id,role,is_family_member)
         values ($1,$2,'coordinator',true)
         on conflict do nothing`, [circle, opts.secondCoordinator]);
    }
    const r = await c.query(
      `update public.circle_members set removed_at=now()
       where circle_id=$1 and user_id=$2 and removed_at is null returning id`,
      [circle, userId]);
    expect(r.rowCount, "the soft-removal itself must succeed").toBe(1);
  });
}

// An UPDATE/DELETE with no WHERE and no RETURNING requires no READ permission,
// so PostgreSQL applies ONLY the UPDATE/DELETE policy's USING clause — the
// (correctly membership-gated) SELECT policy never enters the picture. Every
// statement below therefore ran unfiltered against the write policy alone.
// These all SUCCEEDED for the attacker before the membership gate was added:
// 4 checkin_content rows, 4 checkins rows, 1 shift, 1 adhoc_task.
describe("a soft-removed member has NO write access to the circle's data", () => {
  test("removed coordinator cannot DELETE or UPDATE check-ins she recorded", async () => {
    // control: while still a member, these statements DO reach rows.
    const control = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("delete from public.checkins returning id"));
    expect(control.rowCount, "control: the exploit target rows exist").toBeGreaterThan(0);

    await softRemove(fx.users.A1_coordinator, fx.circleA1, {
      org: fx.orgA, newOwner: fx.users.twoCircle,
      secondCoordinator: fx.users.twoCircle,
    });

    const content = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("delete from public.checkin_content returning checkin_id"));
    expect(content.rowCount, "DELETE checkin_content as a removed member").toBe(0);

    const parents = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("delete from public.checkins returning id"));
    expect(parents.rowCount, "DELETE checkins as a removed member").toBe(0);

    const widened = await asUser(fx.users.A1_coordinator, (c) =>
      c.query("update public.checkins set visibility='circle' returning id"));
    expect(widened.rowCount, "UPDATE checkins as a removed member").toBe(0);
  });

  test("removed caregiver cannot check in to a shift or DELETE their ad-hoc task", async () => {
    const controlShift = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("update public.shifts set checked_in_at=now() returning id"));
    expect(controlShift.rowCount, "control: an assigned shift exists").toBeGreaterThan(0);
    const controlTask = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("delete from public.adhoc_tasks returning id"));
    expect(controlTask.rowCount, "control: an authored ad-hoc task exists").toBeGreaterThan(0);

    await softRemove(fx.users.A1_caregiver_hired, fx.circleA1);

    const shift = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("update public.shifts set checked_in_at=now() returning id"));
    expect(shift.rowCount, "UPDATE shifts as a removed caregiver").toBe(0);

    const task = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("delete from public.adhoc_tasks returning id"));
    expect(task.rowCount, "DELETE adhoc_tasks as a removed caregiver").toBe(0);
  });

  test("removed member's data is still intact afterwards", async () => {
    await softRemove(fx.users.A1_caregiver_hired, fx.circleA1);
    // the attacker's committed damage, if any, would show up here
    await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query("delete from public.adhoc_tasks"));
    const n = await withAdmin((c) =>
      c.query(`select count(*)::int n from public.adhoc_tasks where circle_id=$1`,
        [fx.circleA1]));
    expect(n.rows[0].n).toBe(1);
  });
});
