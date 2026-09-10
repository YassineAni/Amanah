import { beforeEach, describe, expect, test } from "vitest";
import { admin, rawAsUser } from "./clients";
import { loadFixture, type Fixture } from "./fixture";
import { randomUUID } from "node:crypto";

let fx: Fixture;
beforeEach(async () => { fx = await loadFixture(); });

describe("last-coordinator / owner guard", () => {
  // circleA2 has exactly two coordinators (A2_coordinator, twoCircle) and
  // NEITHER is the orgA owner — so this exercises the last-coordinator branch,
  // not the owner branch.
  test("removing the last coordinator is rejected", async () => {
    const c = admin(); await c.connect();
    try {
      await c.query(
        `update public.circle_members set removed_at = now()
         where circle_id = $1 and user_id = $2`,
        [fx.circleA2, fx.users.twoCircle],
      );
      await expect(c.query(
        `update public.circle_members set removed_at = now()
         where circle_id = $1 and user_id = $2`,
        [fx.circleA2, fx.users.A2_coordinator],
      )).rejects.toThrow(/last coordinator/i);
    } finally { await c.end(); }
  });

  test("removing the org owner's membership is rejected", async () => {
    // A1_coordinator is orgA owner. Add a 2nd coordinator so 'last coordinator'
    // is not the blocker, then try to remove the owner.
    const c = admin(); await c.connect();
    try {
      await c.query(
        `insert into public.circle_members (circle_id,user_id,role) values ($1,$2,'coordinator')`,
        [fx.circleA1, fx.users.twoCircle],
      );
      await expect(c.query(
        `update public.circle_members set removed_at = now()
         where circle_id = $1 and user_id = $2`,
        [fx.circleA1, fx.users.A1_coordinator],
      )).rejects.toThrow(/organization owner/i);
    } finally { await c.end(); }
  });

  test("the FOR UPDATE lock serialises two concurrent last-two-coordinator removals", async () => {
    // circleA2's two coordinators (A2_coordinator, twoCircle), neither the owner.
    // Without the lock both txns see "2 coordinators, removing me leaves 1" and
    // both commit -> 0. With the lock: A wins, B blocks, B re-evaluates against
    // A's committed state -> "removing me leaves 0" -> B RAISES. One survives.
    //
    // Both connections are app_authenticated (NOT admin()): postgres has
    // BYPASSRLS, under which the guard's `select circles ... for update` always
    // took its lock. On the production role it silently matched zero rows and
    // locked nothing until guard_member_removal() became SECURITY DEFINER, so
    // an admin()-based version of this test passed while proving nothing.
    // Each coordinator removes HERSELF — spec §5/C9's concurrent self-removal.
    const a = await rawAsUser(fx.users.A2_coordinator);
    const b = await rawAsUser(fx.users.twoCircle);
    try {
      const removeSelf = (c: typeof a, uid: string) =>
        c.query(`update public.circle_members set removed_at=now()
                 where circle_id=$1 and user_id=$2 returning id`, [fx.circleA2, uid]);

      const aResult = await removeSelf(a, fx.users.A2_coordinator);
      expect(aResult.rowCount).toBe(1);          // A's removal really happened

      const bPromise = removeSelf(b, fx.users.twoCircle);
      // prove B is actually waiting on A's lock: race it against a short timer.
      const timer = new Promise((res) => setTimeout(() => res("blocked"), 400));
      expect(await Promise.race([bPromise.then(() => "ran"), timer])).toBe("blocked");

      await a.query("commit");
      await expect(bPromise).rejects.toThrow(/last coordinator/i);
      await b.query("rollback");

      const check = await admin();
      await check.connect();
      try {
        const r = await check.query(`select count(*)::int n from public.circle_members
          where circle_id=$1 and role='coordinator' and removed_at is null`, [fx.circleA2]);
        expect(r.rows[0].n).toBe(1);             // exactly one coordinator survived
      } finally { await check.end(); }
    } finally { await a.end(); await b.end(); }
  });
});

describe("immutability", () => {
  test("circle_id on a check-in is frozen", async () => {
    const c = admin(); await c.connect();
    try {
      await expect(c.query(
        `update public.checkins set circle_id=$1 where id=$2`,
        [fx.circleA2, fx.checkins.A1_circle],
      )).rejects.toThrow(/immutable/i);
    } finally { await c.end(); }
  });

  test("recorded_by on checkin_content is frozen", async () => {
    const c = admin(); await c.connect();
    try {
      await expect(c.query(
        `update public.checkin_content set recorded_by=$1 where checkin_id=$2`,
        [fx.users.A1_family, fx.checkins.A1_circle],
      )).rejects.toThrow(/immutable/i);
    } finally { await c.end(); }
  });
});

describe("cross-table invariants enforced by the DB, not by 1b's discipline", () => {
  test("a parent visibility change propagates to checkin_content", async () => {
    const c = admin(); await c.connect();
    try {
      await c.query(`update public.checkins set visibility='coordinator' where id=$1`,
        [fx.checkins.A1_family]);
      const r = await c.query(
        `select visibility from public.checkin_content where checkin_id=$1`,
        [fx.checkins.A1_family]);
      // the child's copy is the one that actually gates disclosure (D12)
      expect(r.rows[0].visibility).toBe("coordinator");
    } finally { await c.end(); }
  });

  test("soft-removing the elder's membership clears circles.elder_user_id", async () => {
    const c = admin(); await c.connect();
    try {
      await c.query(`update public.circle_members set removed_at=now()
                     where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_elder]);
      const r = await c.query(`select elder_user_id from public.circles where id=$1`,
        [fx.circleA1]);
      expect(r.rows[0].elder_user_id).toBeNull();
    } finally { await c.end(); }
  });
});

describe("handle_new_user full_name", () => {
  // full_name falls back to the email local-part (no '@') when metadata is
  // absent or blank, is truncated to 120 chars, and is otherwise stored verbatim.
  const cases: [string, unknown, RegExp][] = [
    ["absent", undefined, /^new-user-absent$/],
    ["empty", "", /^new-user-empty$/],
    ["huge", "x".repeat(10_000), /^x{120}$/],
    ["script", "<script>alert(1)</script>", /script/],  // stored literally, bounded
  ];
  for (const [label, meta, re] of cases) {
    test(`full_name (${label}) is non-null and <= 120 chars`, async () => {
      const c = admin(); await c.connect();
      try {
        const id = randomUUID();
        const raw = meta === undefined ? "{}" : JSON.stringify({ full_name: meta });
        await c.query(
          `insert into auth.users (id,instance_id,aud,role,email,encrypted_password,
             created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
           values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
             $2,'',now(),now(),'{}',$3::jsonb)`,
          [id, `new-user-${label}@example.com`, raw],
        );
        const r = await c.query(`select full_name from public.profiles where id=$1`, [id]);
        expect(r.rows[0].full_name).not.toBeNull();
        expect(r.rows[0].full_name.length).toBeLessThanOrEqual(120);
        expect(r.rows[0].full_name).toMatch(re);
      } finally { await c.end(); }
    });
  }
});
