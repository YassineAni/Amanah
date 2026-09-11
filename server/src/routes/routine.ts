import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { asyncHandler } from "../http/asyncHandler.js";

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
  const r = await withUserTxn(req.claims, (q) =>
    q.query(
      `insert into public.routine_items (circle_id, title, time_of_day, category, time_sensitive, weekdays)
       values ($1,$2,$3,$4,$5,$6) returning id, title, time_of_day::text, category, time_sensitive, weekdays, effective_from::text`,
      [req.params.cid, String(b.title).trim().slice(0, 120), b.time,
       CATS.has(b.category) ? b.category : "other", !!b.time_sensitive, weekdays],
    ),
  );
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
    await q.query(`update public.routine_items set archived_at = now() where id = $1`, [cur.id]);
    const merged = {
      title: typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : cur.title,
      time: isTime(b.time) ? b.time : cur.time_of_day,
      category: CATS.has(b.category) ? b.category : cur.category,
      time_sensitive: typeof b.time_sensitive === "boolean" ? b.time_sensitive : cur.time_sensitive,
      weekdays: Array.isArray(b.weekdays) && b.weekdays.length ? cleanWeekdays(b.weekdays) : cur.weekdays,
    };
    const ins = await q.query(
      `insert into public.routine_items (circle_id, title, time_of_day, category, time_sensitive, weekdays)
       values ($1,$2,$3,$4,$5,$6)
       returning id, title, time_of_day::text, category, time_sensitive, weekdays, effective_from::text`,
      [cid, merged.title, merged.time, merged.category, merged.time_sensitive, merged.weekdays],
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
