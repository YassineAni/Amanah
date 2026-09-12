import { randomUUID } from "node:crypto";
import { admin } from "./clients";

export interface Fixture {
  orgA: string; orgB: string;
  circleA1: string; circleA2: string; circleB1: string;
  users: Record<string, string>;
  checkins: Record<string, string>;
  // Added by the final-review fix wave. Every tenant table is now non-empty in
  // at least two circles, so the cross-tenant assertions in select-matrix are
  // load-bearing rather than vacuously true on an empty table.
  shifts: Record<string, string>;
  routineItems: Record<string, string>;
  completions: Record<string, string>;
  adhocTasks: Record<string, string>;
  invites: Record<string, string>;
}

const USERS = [
  "A1_coordinator", "A1_elder", "A1_caregiver_hired", "A1_family",
  "A2_coordinator", "B1_coordinator", "twoCircle",
  // the elder / is_family_member = false cell (spec §11's role x is_family
  // matrix). Distinguishes "the family tier ADMITS me" from "I am the elder",
  // which is exactly what upd_checkins' visibility disjunct must test.
  "A2_elder_notfamily",
] as const;

async function mkUser(c: import("pg").Client, label: string): Promise<string> {
  const id = randomUUID();
  await c.query(
    `insert into auth.users
       (id, instance_id, aud, role, email, encrypted_password,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
     values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
             $2,'',now(),now(),'{}', jsonb_build_object('full_name',$3::text))`,
    [id, `${label}@example.com`, label.replace(/_/g, " ")],
  );
  return id; // handle_new_user() created the profiles row
}

export async function loadFixture(): Promise<Fixture> {
  const c = admin();
  await c.connect();
  try {
    await c.query(`truncate table
      public.checkin_content, public.checkins, public.shifts,
      public.completions, public.adhoc_tasks, public.routine_items,
      public.invites, public.circle_members, public.circles,
      public.organizations restart identity cascade`);
    await c.query(`delete from auth.users where email like '%@example.com'`);

    const users: Record<string, string> = {};
    for (const label of USERS) users[label] = await mkUser(c, label);

    const orgA = randomUUID(), orgB = randomUUID();
    await c.query(`insert into public.organizations (id,name,kind,owner_user_id) values
      ($1,'Org A','family',$2), ($3,'Org B','family',$4)`,
      [orgA, users.A1_coordinator, orgB, users.B1_coordinator]);

    const circleA1 = randomUUID(), circleA2 = randomUUID(), circleB1 = randomUUID();
    await c.query(`insert into public.circles (id,org_id,name,elder_name,elder_lang,timezone) values
      ($1,$2,'A1','Amina','ar','America/Toronto'),
      ($3,$2,'A2','Bilal','fr','America/Toronto'),
      ($4,$5,'B1','Carmen','en','America/Toronto')`,
      [circleA1, orgA, circleA2, circleB1, orgB]);

    // memberships
    const mem = async (circle: string, user: string, role: string, fam: boolean) =>
      c.query(`insert into public.circle_members (circle_id,user_id,role,is_family_member)
               values ($1,$2,$3,$4)`, [circle, user, role, fam]);
    await mem(circleA1, users.A1_coordinator, "coordinator", true);
    await mem(circleA1, users.A1_elder, "elder", true);
    await mem(circleA1, users.A1_caregiver_hired, "caregiver", false);
    await mem(circleA1, users.A1_family, "family", true);
    await c.query(`update public.circles set elder_user_id=$1 where id=$2`,
      [users.A1_elder, circleA1]);
    await mem(circleA2, users.A2_coordinator, "coordinator", true);
    // A2's elder is NOT a family member: the family tier does not admit her.
    // (membership row first — circles_elder_consistency validates the pair.)
    await mem(circleA2, users.A2_elder_notfamily, "elder", false);
    await c.query(`update public.circles set elder_user_id=$1 where id=$2`,
      [users.A2_elder_notfamily, circleA2]);
    await mem(circleB1, users.B1_coordinator, "coordinator", true);
    // twoCircle is coordinator in A2 AND family in B1 — the multi-circle viewer
    await mem(circleA2, users.twoCircle, "coordinator", true);
    await mem(circleB1, users.twoCircle, "family", true);

    // "Today" for all seeded rows below is computed in America/Toronto (the
    // timezone every fixture circle uses), NOT the bare SQL current_date
    // (the DB session's default, effectively UTC on this stack). Every 1b
    // handler that answers "what day is it for this circle" (windowDates,
    // GET /today, GET /plan's default date, routine.ts's effective_from)
    // does the same circle-tz-aware computation — using current_date here
    // would silently disagree with all of them for ~4-5 hours a day (the
    // UTC-vs-Toronto offset window), which is exactly what surfaced as an
    // intermittent GET /today failure. (1a's own tests never compare these
    // seeded dates against a tz-aware computation, so this was latent
    // until 1b's timezone-aware endpoints existed to disagree with it.)
    const TODAY = `(now() at time zone 'America/Toronto')::date`;
    const checkins: Record<string, string> = {};
    const addCheckin = async (
      key: string, visibility: string, recorder: string, isProxy: boolean,
      circle: string = circleA1,
    ) => {
      const id = randomUUID();
      await c.query(
        `insert into public.checkins (id,circle_id,occurred_on,mood,spoken_lang,visibility,recorded_by,is_proxy,created_via)
         values ($1,$2,${TODAY},'ok','ar',$3,$4,$5,'demo')`,
        [id, circle, visibility, recorder, isProxy],
      );
      await c.query(
        `insert into public.checkin_content (checkin_id,circle_id,visibility,recorded_by,is_proxy,transcript,translation)
         values ($1,$2,$3,$4,$5,'words','words')`,
        [id, circle, visibility, recorder, isProxy],
      );
      checkins[key] = id;
    };
    await addCheckin("A1_circle", "circle", users.A1_coordinator, true);
    await addCheckin("A1_family", "family", users.A1_coordinator, true);
    await addCheckin("A1_coordinator", "coordinator", users.A1_coordinator, true);
    await addCheckin("A1_moodonly", "mood_only", users.A1_coordinator, true);
    await addCheckin("A1_elder_self", "family", users.A1_elder, false);
    // circleA2: a family-tier proxy row the NOT-family elder cannot see. She
    // must not be able to widen it either (upd_checkins' admission test).
    await addCheckin("A2_family", "family", users.A2_coordinator, true, circleA2);
    // circleB1: the other tenant. Without these, "viewer sees only their own
    // circle" is true no matter what RLS does.
    await addCheckin("B1_circle", "circle", users.B1_coordinator, true, circleB1);
    await addCheckin("B1_family", "family", users.B1_coordinator, true, circleB1);

    // ---- the five tables that used to be empty everywhere ----------------
    const one = async (sql: string, params: unknown[]): Promise<string> =>
      (await c.query(sql, params)).rows[0].id as string;

    const shifts: Record<string, string> = {
      // assigned to the hired caregiver: the row a REMOVED caregiver must no
      // longer be able to check in to (delete-matrix).
      A1: await one(
        `insert into public.shifts (circle_id,starts_at,ends_at,caregiver_id,purpose)
         values ($1, now(), now() + interval '2 hours', $2, 'morning visit') returning id`,
        [circleA1, users.A1_caregiver_hired]),
      B1: await one(
        `insert into public.shifts (circle_id,starts_at,ends_at,caregiver_id,purpose)
         values ($1, now(), now() + interval '2 hours', $2, 'B1 visit') returning id`,
        [circleB1, users.B1_coordinator]),
    };

    const routineItems: Record<string, string> = {
      A1: await one(
        `insert into public.routine_items (circle_id,title,time_of_day,weekdays)
         values ($1,'A1 morning meds','08:00','{1,2,3,4,5}') returning id`, [circleA1]),
      B1: await one(
        `insert into public.routine_items (circle_id,title,time_of_day,weekdays)
         values ($1,'B1 morning meds','08:00','{1,2,3,4,5}') returning id`, [circleB1]),
    };

    const completions: Record<string, string> = {
      A1: await one(
        `insert into public.completions (circle_id,routine_item_id,on_date,done_by)
         values ($1,$2,${TODAY},$3) returning id`,
        [circleA1, routineItems.A1, users.A1_caregiver_hired]),
      B1: await one(
        `insert into public.completions (circle_id,routine_item_id,on_date,done_by)
         values ($1,$2,${TODAY},$3) returning id`,
        [circleB1, routineItems.B1, users.B1_coordinator]),
    };

    const adhocTasks: Record<string, string> = {
      // added_by the hired caregiver: the row a REMOVED caregiver must no
      // longer be able to delete (delete-matrix).
      A1: await one(
        `insert into public.adhoc_tasks (circle_id,on_date,title,time_of_day,added_by)
         values ($1,${TODAY},'A1 pharmacy run','14:00',$2) returning id`,
        [circleA1, users.A1_caregiver_hired]),
      B1: await one(
        `insert into public.adhoc_tasks (circle_id,on_date,title,time_of_day,added_by)
         values ($1,${TODAY},'B1 pharmacy run','14:00',$2) returning id`,
        [circleB1, users.B1_coordinator]),
    };

    const invites: Record<string, string> = {
      // pending (accepted_at null) — sel_invites is coordinator-only, so a
      // plain family member of A1 must not see this token/email.
      A1: await one(
        `insert into public.invites (circle_id,email,role,token,invited_by)
         values ($1,'pending-a1@example.com','caregiver',$2,$3) returning id`,
        [circleA1, `tok-a1-${randomUUID()}`, users.A1_coordinator]),
      B1: await one(
        `insert into public.invites (circle_id,email,role,token,invited_by)
         values ($1,'pending-b1@example.com','family',$2,$3) returning id`,
        [circleB1, `tok-b1-${randomUUID()}`, users.B1_coordinator]),
    };

    return {
      orgA, orgB, circleA1, circleA2, circleB1, users, checkins,
      shifts, routineItems, completions, adhocTasks, invites,
    };
  } finally {
    await c.end();
  }
}
