import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { windowDates } from "../domain/careSignal.js";
import { utterances } from "../domain/utterances.js";
import { asyncHandler } from "../http/asyncHandler.js";

export const checkinsRouter = Router({ mergeParams: true });
checkinsRouter.use(requireAuth, requireNoticeAccepted, requireCircle());

checkinsRouter.get("/checkins", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const rows = await withUserTxn(req.claims, (q) =>
    q.query(
      `select c.id, c.occurred_on::text, c.mood, c.spoken_lang, c.is_proxy, c.visibility,
              p.full_name as recorded_by_name,
              cc.transcript, cc.translation,
              (cc.audio_path is not null) as has_audio
       from public.checkins c
       join public.profiles p on p.id = c.recorded_by
       left join public.checkin_content cc on cc.checkin_id = c.id
       where c.circle_id = $1
       order by c.occurred_on desc, c.created_at desc`, [cid],
    ),
  );
  res.json(rows.rows);
}));

checkinsRouter.get("/demo/utterances", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const r = await withUserTxn(req.claims, (q) =>
    q.query(
      `select 1 from public.circles c join public.organizations o on o.id = c.org_id
       where c.id = $1 and o.is_demo`, [cid],
    ),
  );
  if (r.rowCount === 0) return res.status(404).json({ error: "not a demo circle" });
  res.json(utterances.map((u) => ({ id: u.id, label: u.label })));
}));

checkinsRouter.get("/today", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const data = await withUserTxn(req.claims, async (q) => {
    const tz = (await q.query(`select timezone from public.circles where id = $1`, [cid])).rows[0]?.timezone ?? "UTC";
    const today = windowDates(tz)[6];
    // occurred_on::text — pg parses a bare `date` column as a JS Date
    // object, which would never === the "YYYY-MM-DD" string `today` below.
    const last = (await q.query(
      `select mood, occurred_on::text from public.checkins
       where circle_id = $1 order by occurred_on desc, created_at desc limit 1`, [cid],
    )).rows[0];
    return {
      today,
      has_checkin: last?.occurred_on === today,
      last_mood: last?.mood ?? null,
    };
  });
  res.json(data);
}));
