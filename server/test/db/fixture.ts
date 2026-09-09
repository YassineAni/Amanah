import { randomUUID } from "node:crypto";
import { admin } from "./clients";

export interface Fixture {
  orgA: string; orgB: string;
  circleA1: string; circleA2: string; circleB1: string;
  users: Record<string, string>;
  checkins: Record<string, string>;
}

const USERS = [
  "A1_coordinator", "A1_elder", "A1_caregiver_hired", "A1_family",
  "A2_coordinator", "B1_coordinator", "twoCircle",
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
    await mem(circleB1, users.B1_coordinator, "coordinator", true);
    // twoCircle is coordinator in A2 AND family in B1 — the multi-circle viewer
    await mem(circleA2, users.twoCircle, "coordinator", true);
    await mem(circleB1, users.twoCircle, "family", true);

    // one check-in per visibility in circle A1, recorded by the coordinator
    // as a proxy EXCEPT the "elder_self" one; plus one proxy coordinator-tier.
    const checkins: Record<string, string> = {};
    const addCheckin = async (
      key: string, visibility: string, recorder: string, isProxy: boolean,
    ) => {
      const id = randomUUID();
      await c.query(
        `insert into public.checkins (id,circle_id,occurred_on,mood,spoken_lang,visibility,recorded_by,is_proxy,created_via)
         values ($1,$2,current_date,'ok','ar',$3,$4,$5,'demo')`,
        [id, circleA1, visibility, recorder, isProxy],
      );
      await c.query(
        `insert into public.checkin_content (checkin_id,circle_id,visibility,recorded_by,is_proxy,transcript,translation)
         values ($1,$2,$3,$4,$5,'words','words')`,
        [id, circleA1, visibility, recorder, isProxy],
      );
      checkins[key] = id;
    };
    await addCheckin("A1_circle", "circle", users.A1_coordinator, true);
    await addCheckin("A1_family", "family", users.A1_coordinator, true);
    await addCheckin("A1_coordinator", "coordinator", users.A1_coordinator, true);
    await addCheckin("A1_moodonly", "mood_only", users.A1_coordinator, true);
    await addCheckin("A1_elder_self", "family", users.A1_elder, false);

    return { orgA, orgB, circleA1, circleA2, circleB1, users, checkins };
  } finally {
    await c.end();
  }
}
