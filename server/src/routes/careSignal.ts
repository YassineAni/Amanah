import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { windowDates, weekStrip } from "../domain/careSignal.js";
import { asyncHandler } from "../http/asyncHandler.js";

export const careSignalRouter = Router();

careSignalRouter.get(
  "/circles/:cid/care-signal",
  requireAuth, requireNoticeAccepted, requireCircle(),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const cid = req.params.cid;
    const data = await withUserTxn(req.claims, async (q) => {
      const tz = (await q.query(`select timezone from public.circles where id = $1`, [cid]))
        .rows[0]?.timezone ?? "UTC";
      const dates = windowDates(tz);
      const from = dates[0], to = dates[dates.length - 1];
      const checkins = (await q.query(
        `select c.circle_id, c.occurred_on::text, c.mood,
                (cc.checkin_id is not null) as has_content
         from public.checkins c
         left join public.checkin_content cc on cc.checkin_id = c.id
         where c.circle_id = $1 and c.occurred_on between $2 and $3
         order by c.occurred_on, c.created_at`, [cid, from, to],
      )).rows;
      const shifts = (await q.query(
        `select s.circle_id, s.starts_at::text, s.activity_tags,
                p.full_name as caregiver_name
         from public.shifts s
         left join public.profiles p on p.id = s.caregiver_id
         where s.circle_id = $1 and s.starts_at::date between $2 and $3`, [cid, from, to],
      )).rows;
      return { window: dates, days: weekStrip(cid, dates, checkins as any, shifts as any) };
    });
    res.json(data);
  }),
);

careSignalRouter.get(
  "/my-shifts",
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await withUserTxn(req.claims, (q) =>
      q.query(
        `select s.id, s.circle_id, c.name as circle_name, s.starts_at, s.ends_at, s.purpose
         from public.shifts s
         join public.circles c on c.id = s.circle_id
         where s.caregiver_id = $1 and s.starts_at >= now()
         order by s.starts_at`, [req.claims.sub],
      ),
    );
    res.json({ shifts: rows.rows });
  }),
);
