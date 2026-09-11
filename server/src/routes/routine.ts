import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn, type Querier } from "../db/pool.js";
import { windowDates } from "../domain/careSignal.js";
import { asyncHandler } from "../http/asyncHandler.js";

// The Postgres column default (current_date) resolves in the DB session's
// timezone (UTC here, unset elsewhere), not the circle's — near local
// midnight that can silently misdate a new/replacement row by one day
// relative to what the coordinator saw. Every other "what day is it for
// this circle" computation in this codebase goes through windowDates(tz);
// mirror that here instead of relying on the column default.
async function circleToday(q: Querier, cid: string): Promise<string> {
  const tz = (await q.query(`select timezone from public.circles where id = $1`, [cid]))
    .rows[0]?.timezone ?? "UTC";
  return windowDates(tz)[6];
}

export const routineRouter = Router({ mergeParams: true });
routineRouter.use(requireAuth, requireNoticeAccepted, requireCircle("coordinator"));

const CATS = new Set(["medication","personal_care","meal","rest","activity","other"]);
const isTime = (v: unknown) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
const cleanWeekdays = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() : [];

routineRouter.get("/routine", asyncHandler<AuthedRequest>(async (req, res) => {
  const rows = await withUserTxn(req.claims, (q) =>
    q.query(
      `select id, title, time_of_day::text, category, time_sensitive, weekdays, effective_from::text
       from public.routine_items
       where circle_id = $1 and archived_at is null
       order by time_of_day`, [req.params.cid],
    ),
  );
  res.json(rows.rows);
}));

routineRouter.post("/routine", asyncHandler<AuthedRequest>(async (req, res) => {
  const b = req.body ?? {};
  const weekdays = cleanWeekdays(b.weekdays);
  if (!String(b.title ?? "").trim() || !isTime(b.time) || weekdays.length === 0) {
    return res.status(400).json({ error: "title, HH:MM time, and weekdays[] are required" });
  }
  const r = await withUserTxn(req.claims, async (q) => {
    const today = await circleToday(q, req.params.cid);
    return q.query(
      `insert into public.routine_items (circle_id, title, time_of_day, category, time_sensitive, weekdays, effective_from)
       values ($1,$2,$3,$4,$5,$6,$7) returning id, title, time_of_day::text, category, time_sensitive, weekdays, effective_from::text`,
      [req.params.cid, String(b.title).trim().slice(0, 120), b.time,
       CATS.has(b.category) ? b.category : "other", !!b.time_sensitive, weekdays, today],
    );
  });
  res.status(201).json(r.rows[0]);
}));

routineRouter.patch("/routine/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const b = req.body ?? {};
  const out = await withUserTxn(req.claims, async (q) => {
    const cur = (await q.query(
      `select * from public.routine_items where id = $1 and circle_id = $2 and archived_at is null`,
      [req.params.id, cid])).rows[0];
    if (!cur) throw Object.assign(new Error("no such routine item"), { status: 404 });
    const today = await circleToday(q, cid);
    await q.query(
      `update public.routine_items set archived_at = now() where id = $1 and circle_id = $2`,
      [cur.id, cid],
    );
    const merged = {
      title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : cur.title,
      time: isTime(b.time) ? b.time : cur.time_of_day,
      category: CATS.has(b.category) ? b.category : cur.category,
      time_sensitive: typeof b.time_sensitive === "boolean" ? b.time_sensitive : cur.time_sensitive,
      weekdays: Array.isArray(b.weekdays) && b.weekdays.length ? cleanWeekdays(b.weekdays) : cur.weekdays,
    };
    const ins = await q.query(
      `insert into public.routine_items (circle_id, title, time_of_day, category, time_sensitive, weekdays, effective_from)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, title, time_of_day::text, category, time_sensitive, weekdays, effective_from::text`,
      [cid, merged.title, merged.time, merged.category, merged.time_sensitive, merged.weekdays, today],
    );
    return ins.rows[0];
  });
  res.json(out);
}));

routineRouter.delete("/routine/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const r = await withUserTxn(req.claims, (q) =>
    q.query(
      `update public.routine_items set archived_at = now()
       where id = $1 and circle_id = $2 and archived_at is null returning id`,
      [req.params.id, req.params.cid],
    ),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "no such routine item" });
  res.status(204).end();
}));
