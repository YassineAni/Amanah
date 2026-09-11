import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn, type Querier } from "../db/pool.js";
import { expandDay } from "../domain/plan.js";
import { windowDates } from "../domain/careSignal.js";
import { asyncHandler } from "../http/asyncHandler.js";

export const planRouter = Router({ mergeParams: true });
planRouter.use(requireAuth, requireNoticeAccepted, requireCircle());

const CATS = new Set(["medication","personal_care","meal","rest","activity","other"]);
const isTime = (v: unknown) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);

async function loadPlan(q: Querier, cid: string, date: string) {
  const routine = (await q.query(
    `select id, title, time_of_day::text, category, time_sensitive, weekdays,
            effective_from::text, archived_at
     from public.routine_items where circle_id = $1`, [cid])).rows;
  const completions = (await q.query(
    `select cp.routine_item_id, cp.on_date::text, cp.done_at, cp.done_by,
            p.full_name as done_by_name, cp.note
     from public.completions cp join public.profiles p on p.id = cp.done_by
     where cp.circle_id = $1 and cp.on_date = $2`, [cid, date])).rows;
  const adhoc = (await q.query(
    `select a.id, a.on_date::text, a.title, a.time_of_day::text, a.category, a.time_sensitive,
            a.done_at, a.done_by, dp.full_name as done_by_name, ap.full_name as added_by_name, a.note
     from public.adhoc_tasks a
     join public.profiles ap on ap.id = a.added_by
     left join public.profiles dp on dp.id = a.done_by
     where a.circle_id = $1 and a.on_date = $2`, [cid, date])).rows;
  return expandDay(date, routine as any, completions as any, adhoc as any);
}

planRouter.get("/plan", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const out = await withUserTxn(req.claims, async (q) => {
    const tz = (await q.query(`select timezone from public.circles where id=$1`, [cid])).rows[0]?.timezone ?? "UTC";
    const date = typeof req.query.date === "string" ? req.query.date : windowDates(tz)[6];
    return { date, tasks: await loadPlan(q, cid, date) };
  });
  res.json(out);
}));

planRouter.post("/plan/toggle", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const { claims, membership } = req;
  if (!["coordinator", "caregiver"].includes(membership!.role)) {
    return res.status(403).json({ error: "coordinator or caregiver only" });
  }
  const { date, key, done } = req.body ?? {};
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 300) || null : null;
  if (!date || typeof key !== "string") return res.status(400).json({ error: "date and key required" });

  const out = await withUserTxn(claims, async (q) => {
    if (key.startsWith("r:")) {
      const rid = key.slice(2);
      if (done) {
        await q.query(
          `insert into public.completions (circle_id, routine_item_id, on_date, done_by, note)
           values ($1,$2,$3,$4,$5)
           on conflict (routine_item_id, on_date)
           do update set note = coalesce(excluded.note, public.completions.note)`,
          [cid, rid, date, claims.sub, note],
        );
      } else {
        await q.query(`delete from public.completions where routine_item_id = $1 and on_date = $2 and circle_id = $3`,
          [rid, date, cid]);
      }
    } else if (key.startsWith("a:")) {
      const aid = key.slice(2);
      if (done) {
        await q.query(
          `update public.adhoc_tasks set done_at = now(), done_by = $3, note = coalesce($4, note)
           where id = $1 and circle_id = $2`, [aid, cid, claims.sub, note]);
      } else {
        await q.query(
          `update public.adhoc_tasks set done_at = null, done_by = null
           where id = $1 and circle_id = $2`, [aid, cid]);
      }
    } else {
      throw Object.assign(new Error("bad key"), { status: 400 });
    }
    return { date, tasks: await loadPlan(q, cid, date) };
  });
  res.json(out);
}));

planRouter.post("/adhoc", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const { claims, membership } = req;
  if (!["coordinator", "caregiver"].includes(membership!.role)) {
    return res.status(403).json({ error: "coordinator or caregiver only" });
  }
  const b = req.body ?? {};
  if (!String(b.title ?? "").trim() || !isTime(b.time)) {
    return res.status(400).json({ error: "title and a HH:MM time are required" });
  }
  const out = await withUserTxn(claims, async (q) => {
    const tz = (await q.query(`select timezone from public.circles where id=$1`, [cid])).rows[0]?.timezone ?? "UTC";
    const date = typeof b.date === "string" ? b.date : windowDates(tz)[6];
    await q.query(
      `insert into public.adhoc_tasks (circle_id, on_date, title, time_of_day, category, time_sensitive, added_by, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [cid, date, String(b.title).trim().slice(0, 120), b.time,
       CATS.has(b.category) ? b.category : "other", !!b.time_sensitive, claims.sub,
       typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null],
    );
    return { date, tasks: await loadPlan(q, cid, date) };
  });
  res.status(201).json(out);
}));

planRouter.delete("/adhoc/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const r = await withUserTxn(req.claims, (q) =>
    q.query(`delete from public.adhoc_tasks where id = $1 and circle_id = $2 returning id`,
      [req.params.id, req.params.cid]),
  );
  if (r.rowCount === 0) return res.status(403).json({ error: "cannot delete this task" });
  res.status(204).end();
}));
