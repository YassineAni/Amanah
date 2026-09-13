import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { windowDates, weekStrip, shiftHeaderContext } from "../domain/careSignal.js";
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
      // starts_at is timestamptz; a bare ::date/::text cast renders in the
      // DB session's timezone (UTC here), not the circle's — the same bug
      // class fixed for routine_items.effective_from/archived_at (see
      // routes/plan.ts). `at time zone $4` converts to the circle's local
      // wall-clock time first, so both the day-window filter and the date
      // weekStrip buckets shifts by agree with `dates` (also tz-local).
      const shifts = (await q.query(
        `select s.circle_id, (s.starts_at at time zone $4)::text as starts_at, s.activity_tags,
                p.full_name as caregiver_name
         from public.shifts s
         left join public.profiles p on p.id = s.caregiver_id
         where s.circle_id = $1 and (s.starts_at at time zone $4)::date between $2 and $3`,
        [cid, from, to, tz],
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
        // The lateral join finds the most recent checkin on/before this
        // shift's LOCAL date (per its own circle's timezone — the same
        // "starts_at at time zone c.timezone" pattern used everywhere else
        // in this file) within the same circle, then left-joins its content.
        // checkin_content is forced-RLS: if this caregiver isn't permitted
        // to see that row's content (visibility tier), the join simply
        // returns null transcript/translation — shiftHeaderContext() already
        // treats a missing text as noteHidden, so no separate visibility
        // check is needed here; RLS does that work for free.
        `select s.id, s.circle_id, c.name as circle_name, s.starts_at, s.ends_at, s.purpose,
                s.coordinator_note,
                prior.occurred_on::text as prior_occurred_on, prior.mood as prior_mood,
                cc.transcript as prior_transcript, cc.translation as prior_translation
         from public.shifts s
         join public.circles c on c.id = s.circle_id
         left join lateral (
           select ch.id, ch.occurred_on, ch.mood
           from public.checkins ch
           where ch.circle_id = s.circle_id
             and ch.occurred_on <= (s.starts_at at time zone c.timezone)::date
           order by ch.occurred_on desc, ch.created_at desc
           limit 1
         ) prior on true
         left join public.checkin_content cc on cc.checkin_id = prior.id
         where s.caregiver_id = $1 and s.starts_at >= now()
         order by s.starts_at`, [req.claims.sub],
      ),
    );
    const shifts = rows.rows.map((r) => {
      const { prior_occurred_on, prior_mood, prior_transcript, prior_translation, ...shift } = r;
      const context = shiftHeaderContext(
        prior_occurred_on
          ? {
              occurred_on: prior_occurred_on, mood: prior_mood,
              transcript: prior_transcript ?? "", translation: prior_translation ?? "",
            }
          : null,
        "", // tz param is unused by shiftHeaderContext's own logic
      );
      return { ...shift, context };
    });
    res.json({ shifts });
  }),
);
