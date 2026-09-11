import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { asyncHandler } from "../http/asyncHandler.js";

export const shiftsRouter = Router({ mergeParams: true });
shiftsRouter.use(requireAuth, requireNoticeAccepted, requireCircle());

const TAGS = new Set(["companionship","mobility","outing","meal_prep","hygiene","medical","household","other"]);
const cleanTags = (v: unknown) =>
  Array.isArray(v) ? v.filter((t) => typeof t === "string" && TAGS.has(t)) : [];

shiftsRouter.get("/shifts", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const from = String(req.query.from ?? "1900-01-01");
  const to = String(req.query.to ?? "2999-12-31");
  const rows = await withUserTxn(req.claims, (q) =>
    q.query(
      `select s.id, s.starts_at, s.ends_at, s.caregiver_id, p.full_name as caregiver_name,
              s.purpose, s.activity_tags, s.coordinator_note, s.checked_in_at, s.checked_out_at
       from public.shifts s left join public.profiles p on p.id = s.caregiver_id
       where s.circle_id = $1 and s.starts_at::date between $2 and $3
       order by s.starts_at`, [cid, from, to],
    ),
  );
  res.json(rows.rows);
}));

shiftsRouter.post("/shifts", asyncHandler<AuthedRequest>(async (req, res) => {
  if (req.membership!.role !== "coordinator") {
    return res.status(403).json({ error: "coordinator only" });
  }
  const b = req.body ?? {};
  if (!b.starts_at || !b.ends_at) return res.status(400).json({ error: "starts_at and ends_at required" });
  const r = await withUserTxn(req.claims, (q) =>
    q.query(
      `insert into public.shifts (circle_id, starts_at, ends_at, caregiver_id, purpose, activity_tags, coordinator_note)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [req.params.cid, b.starts_at, b.ends_at, b.caregiver_id ?? null,
       String(b.purpose ?? "").slice(0, 400), cleanTags(b.activity_tags),
       b.coordinator_note ? String(b.coordinator_note).slice(0, 400) : null],
    ),
  );
  res.status(201).json({ id: r.rows[0].id });
}));

shiftsRouter.patch("/shifts/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const { claims, membership } = req;
  const b = req.body ?? {};
  const sets: string[] = [];
  const vals: unknown[] = [req.params.id, req.params.cid];
  const add = (col: string, val: unknown) => { sets.push(`${col} = $${vals.length + 1}`); vals.push(val); };

  if (membership!.role === "coordinator") {
    if ("caregiver_id" in b) add("caregiver_id", b.caregiver_id ?? null);
    if ("activity_tags" in b) add("activity_tags", cleanTags(b.activity_tags));
    if ("coordinator_note" in b) add("coordinator_note", b.coordinator_note ? String(b.coordinator_note).slice(0, 400) : null);
    if ("purpose" in b) add("purpose", String(b.purpose ?? "").slice(0, 400));
  }
  // No app-level check that the caller is THIS shift's assigned caregiver
  // (or a coordinator) before allowing checked_in_at/checked_out_at —
  // that's enforced by RLS's upd_shifts policy (app.is_member(circle_id)
  // and (coordinator or caregiver_id = auth.uid())), not here. An
  // unassigned member's UPDATE matches zero rows and falls into the
  // rowCount === 0 -> 403 branch below. Verified against
  // test/db/write-matrix.test.ts's "unassigned caregiver cannot touch a
  // shift at all" case (Part 1a).
  if ("checked_in_at" in b) add("checked_in_at", b.checked_in_at ?? null);
  if ("checked_out_at" in b) add("checked_out_at", b.checked_out_at ?? null);
  if (!sets.length) return res.status(400).json({ error: "nothing to update" });

  try {
    const r = await withUserTxn(claims, (q) =>
      q.query(
        `update public.shifts set ${sets.join(", ")}
         where id = $1 and circle_id = $2 returning id`, vals,
      ),
    );
    if (r.rowCount === 0) return res.status(403).json({ error: "cannot update this shift" });
    res.json({ id: req.params.id });
  } catch (e: any) {
    if (/only change checked_in_at/i.test(e.message)) {
      return res.status(409).json({ error: e.message });
    }
    throw e;
  }
}));

shiftsRouter.delete("/shifts/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  if (req.membership!.role !== "coordinator") {
    return res.status(403).json({ error: "coordinator only" });
  }
  const r = await withUserTxn(req.claims, (q) =>
    q.query(`delete from public.shifts where id = $1 and circle_id = $2 returning id`,
      [req.params.id, req.params.cid]),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "no such shift" });
  res.status(204).end();
}));
