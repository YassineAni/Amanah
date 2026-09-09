import { beforeEach, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser, asUserCommitted } from "./clients";

let fx: Fixture;
// beforeEach (not beforeAll): asUserCommitted tests leave state behind.
beforeEach(async () => { fx = await loadFixture(); });

const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow();
const allowed = (p: Promise<unknown>) => expect(p).resolves.toBeDefined();

describe("write matrix — role gating", () => {
  test("caregiver cannot INSERT a routine_item", () =>
    denied(asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`insert into public.routine_items (circle_id,title,time_of_day,weekdays)
               values ($1,'x','09:00','{1,2}')`, [fx.circleA1]))));

  test("coordinator CAN INSERT a routine_item", () =>
    allowed(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.routine_items (circle_id,title,time_of_day,weekdays)
               values ($1,'x','09:00','{1,2}')`, [fx.circleA1]))));

  test("family member cannot INSERT a completion", async () => {
    // seed a routine item as the coordinator (committed), then try as family
    const rid = await asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.routine_items (circle_id,title,time_of_day,weekdays)
               values ($1,'y','08:00','{1,2,3,4,5}') returning id`, [fx.circleA1]),
    ).then((r) => r.rows[0].id as string);
    await denied(asUser(fx.users.A1_family, (c) =>
      c.query(`insert into public.completions (circle_id,routine_item_id,on_date,done_by)
               values ($1,$2,current_date,$3)`, [fx.circleA1, rid, fx.users.A1_family])));
  });

  // An RLS UPDATE blocked on the USING side is SILENT (0 rows, no error) —
  // assert the row count, not a throw.
  test("a non-elder cannot change a non-proxy check-in's visibility", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query(`update public.checkins set visibility='circle' where id=$1 returning id`,
        [fx.checkins.A1_elder_self]));
    expect(r.rowCount).toBe(0);
  });

  test("the elder CAN change her own check-in's visibility", async () => {
    const r = await asUser(fx.users.A1_elder, (c) =>
      c.query(`update public.checkins set visibility='circle' where id=$1 returning id`,
        [fx.checkins.A1_elder_self]));
    expect(r.rowCount).toBe(1);
  });

  test("circles cannot be INSERTed by app_authenticated (no policy)", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.circles (org_id,name,elder_name,timezone)
               values ($1,'z','Z','America/Toronto')`, [fx.orgA]))));

  test("circle_members cannot be INSERTed by app_authenticated (no policy)", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`insert into public.circle_members (circle_id,user_id,role)
               values ($1,$2,'family')`, [fx.circleA1, fx.users.twoCircle]))));
});

describe("write matrix — column-scope triggers (committed state)", () => {
  async function seedShift(): Promise<string> {
    return asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(
        `insert into public.shifts (circle_id,starts_at,ends_at,caregiver_id)
         values ($1, now(), now() + interval '2 hours', $2) returning id`,
        [fx.circleA1, fx.users.A1_caregiver_hired],
      ),
    ).then((r) => r.rows[0].id as string);
  }

  test("assigned caregiver CAN set checked_in_at", async () => {
    const id = await seedShift();
    const r = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`update public.shifts set checked_in_at = now() where id = $1 returning id`, [id]));
    expect(r.rowCount).toBe(1);
  });

  test("caregiver setting checked_in_at AND caregiver_id is rejected by the trigger", async () => {
    // the caregiver IS assigned, so RLS USING passes and the column-scope
    // trigger fires and RAISES — a real error, not a silent 0-row.
    const id = await seedShift();
    await denied(asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(
        `update public.shifts set checked_in_at = now(), caregiver_id = $2 where id = $1`,
        [id, fx.users.A1_elder],
      )));
  });

  test("an unassigned caregiver cannot touch a shift at all (RLS)", async () => {
    // RLS blocks on the USING side -> silent 0-row UPDATE, not a throw.
    const id = await seedShift();
    await asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(`update public.shifts set caregiver_id = null where id = $1`, [id]));
    const r = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`update public.shifts set checked_in_at = now() where id = $1 returning id`, [id]));
    expect(r.rowCount).toBe(0);
  });

  test("a removed_at UPDATE that also flips role is rejected", () =>
    denied(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`update public.circle_members set removed_at=now(), role='coordinator'
               where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_family]))));

  test("a coordinator CAN soft-remove a family member (removed_at only)", () =>
    allowed(asUser(fx.users.A1_coordinator, (c) =>
      c.query(`update public.circle_members set removed_at=now()
               where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_family]))));

  test("a soft-removed member then sees nothing (committed removal, fresh read)", async () => {
    await asUserCommitted(fx.users.A1_coordinator, (c) =>
      c.query(`update public.circle_members set removed_at = now()
               where circle_id=$1 and user_id=$2`,
        [fx.circleA1, fx.users.A1_caregiver_hired]));
    const r = await asUser(fx.users.A1_caregiver_hired, (c) =>
      c.query(`select * from public.checkins where circle_id = $1`, [fx.circleA1]));
    expect(r.rowCount).toBe(0);
  });
});
