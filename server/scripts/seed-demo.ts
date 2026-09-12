import "../src/loadEnv.js";
import { withAdminTxn } from "../src/db/pool.js";
import { windowDates } from "../src/domain/careSignal.js";

const emailArg = process.argv.indexOf("--owner-email");
const ownerEmail = emailArg > -1 ? process.argv[emailArg + 1] : "";
if (!ownerEmail) { console.error("usage: npm run seed:demo -- --owner-email <email>"); process.exit(1); }

const TZ = "America/Toronto";
const MOODS = ["good", "ok", "hard", "good", "ok", "good"] as const;
const VIS = ["family", "family", "coordinator", "circle", "mood_only", "family"] as const;

await withAdminTxn(async (q) => {
  const owner = (await q.query(`select id from public.profiles where email = $1`, [ownerEmail])).rows[0];
  if (!owner) throw new Error(`no profile for ${ownerEmail} — sign in once first`);

  const org = (await q.query(
    `insert into public.organizations (name, kind, owner_user_id, is_demo)
     values ('Demo — Amina', 'family', $1, true) returning id`, [owner.id])).rows[0];
  const circle = (await q.query(
    `insert into public.circles (org_id, name, elder_name, elder_lang, timezone)
     values ($1, 'Amina (demo)', 'Amina', 'ar', $2) returning id`, [org.id, TZ])).rows[0];
  await q.query(
    `insert into public.circle_members (circle_id, user_id, role, is_family_member)
     values ($1, $2, 'coordinator', true)`, [circle.id, owner.id]);

  const days = windowDates(TZ);            // 11 days; use the 6 past ones
  for (let i = 0; i < 6; i++) {
    const date = days[i];
    const cin = (await q.query(
      `insert into public.checkins (circle_id, occurred_on, mood, spoken_lang, visibility, recorded_by, is_proxy, created_via)
       values ($1, $2, $3, 'ar', $4, $5, true, 'demo') returning id`,
      [circle.id, date, MOODS[i], VIS[i], owner.id])).rows[0];
    await q.query(
      `insert into public.checkin_content (checkin_id, circle_id, visibility, recorded_by, is_proxy, transcript, translation)
       values ($1, $2, $3, $4, true, $5, $5)`,
      [cin.id, circle.id, VIS[i], owner.id, `Demo note for ${date}.`]);
  }

  for (const [title, time, cat] of [
    ["Morning medication", "08:00", "medication"],
    ["Breakfast", "08:30", "meal"],
    ["Afternoon walk", "15:00", "activity"],
    ["Evening medication", "20:00", "medication"],
  ] as const) {
    await q.query(
      `insert into public.routine_items (circle_id, title, time_of_day, category, time_sensitive, weekdays, effective_from)
       values ($1,$2,$3,$4,true,'{0,1,2,3,4,5,6}', current_date - 30)`,
      [circle.id, title, time, cat]);
  }

  for (const off of [-2, -1, 1, 2]) {
    // current_date + $2 is ambiguous to Postgres without a cast on the
    // bound parameter (candidate operators: date+integer, date+interval,
    // ...) -> "operator is not unique: date + unknown" (42725). $2::int
    // resolves it.
    await q.query(
      `insert into public.shifts (circle_id, starts_at, ends_at, purpose, activity_tags)
       values ($1, (current_date + $2::int)::timestamptz + time '14:00',
                   (current_date + $2::int)::timestamptz + time '16:00',
               'Companionship visit', '{companionship,mobility}')`,
      [circle.id, off]);
  }
  console.log(`seeded demo circle ${circle.id} for ${ownerEmail}`);
});
process.exit(0);
