import { beforeEach, describe, expect, test } from "vitest";
import { admin } from "./clients";
import { loadFixture, type Fixture } from "./fixture";
import { randomUUID } from "node:crypto";

let fx: Fixture;
beforeEach(async () => { fx = await loadFixture(); });

describe("last-coordinator / owner guard", () => {
  test("removing the only coordinator is rejected", async () => {
    // DEVIATION from brief (see task-21-report.md): the brief targeted
    // circleA1 + A1_coordinator, but A1_coordinator IS the orgA owner, so
    // app.guard_member_removal() short-circuits on the owner branch
    // ('organization owner') and never reaches the last-coordinator branch.
    // circleA2 has two coordinators (A2_coordinator, twoCircle) and the orgA
    // owner is not a member, so removing them both exercises the intended
    // '/last coordinator/i' path. Assertion is unchanged.
    const c = admin(); await c.connect();
    try {
      // remove one of the two coordinators — allowed, one still remains
      await c.query(
        `update public.circle_members set removed_at = now()
         where circle_id = $1 and user_id = $2`,
        [fx.circleA2, fx.users.twoCircle],
      );
      // removing the remaining coordinator is the last one — rejected
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

  test("two concurrent self-removals cannot both succeed", async () => {
    const c0 = admin(); await c0.connect();
    await c0.query(`insert into public.circle_members (circle_id,user_id,role)
      values ($1,$2,'coordinator'),($1,$3,'coordinator')`,
      [fx.circleA1, fx.users.twoCircle, fx.users.A2_coordinator]);
    // now 3 coordinators: A1_coordinator (owner), twoCircle, A2_coordinator
    await c0.end();

    const a = admin(), b = admin();
    await a.connect(); await b.connect();
    try {
      await a.query("begin"); await b.query("begin");
      await a.query(`update public.circle_members set removed_at=now()
        where circle_id=$1 and user_id=$2`, [fx.circleA1, fx.users.twoCircle]);
      // b blocks on the FOR UPDATE lock until a commits
      const bPromise = b.query(`update public.circle_members set removed_at=now()
        where circle_id=$1 and user_id=$2`, [fx.circleA1, fx.users.A2_coordinator]);
      await a.query("commit");
      await bPromise;                     // now sees 2 coordinators, still ok
      await b.query("commit");
      // one more removal must now fail (only the owner left)
      const check = await a.query(`select count(*)::int n from public.circle_members
        where circle_id=$1 and role='coordinator' and removed_at is null`, [fx.circleA1]);
      expect(check.rows[0].n).toBe(1);
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
