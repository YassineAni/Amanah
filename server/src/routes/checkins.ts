import multer from "multer";
import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { windowDates } from "../domain/careSignal.js";
import { utterances } from "../domain/utterances.js";
import { resolveSpokenLang, demoTranscribe, liveTranscribe } from "../domain/transcribe.js";
import { uploadStaging, promoteStaging, signedUrl } from "../storage/audio.js";
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const MOODS = new Set(["good", "ok", "hard"]);
const VIS = new Set(["circle", "family", "coordinator", "mood_only"]);
const extFor = (m: string) =>
  m.includes("mp4") || m.includes("m4a") ? "m4a"
  : m.includes("mpeg") || m.includes("mp3") ? "mp3"
  : m.includes("wav") ? "wav" : m.includes("ogg") ? "ogg" : "webm";

checkinsRouter.post(
  "/checkins/transcribe",
  upload.single("audio"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const cid = req.params.cid;
    const { claims, membership } = req;
    if (!["elder", "coordinator", "caregiver"].includes(membership!.role)) {
      return res.status(403).json({ error: "your role cannot record check-ins" });
    }
    const elderLang = await withUserTxn(claims, (q) =>
      q.query(`select elder_lang from public.circles where id = $1`, [cid]),
    ).then((r) => r.rows[0]?.elder_lang ?? "ar");
    const spokenLang = resolveSpokenLang(req.body?.spoken_lang, elderLang);

    if (req.body?.demoUtteranceId) {
      const r = demoTranscribe(String(req.body.demoUtteranceId));
      return res.json({ ...r, staging_path: null });
    }
    if (!req.file) return res.status(400).json({ error: "no audio and no demoUtteranceId" });
    const r = await liveTranscribe(req.file.buffer, req.file.originalname || "audio.webm",
      req.file.mimetype || "audio/webm", spokenLang);
    const staging_path = await uploadStaging(cid, req.file.buffer, extFor(req.file.mimetype || ""));
    res.json({ ...r, staging_path });
  }),
);

checkinsRouter.post("/checkins", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const { claims, membership } = req;
  // Same gate as /checkins/transcribe. Without this, a 'family' role member
  // (a real, non-privileged circle_role) reaches the DB write policy
  // (ins_checkins/ins_checkin_content require elder/coordinator/caregiver),
  // which throws 42501 -- a 500, not a clean 403, for a routine
  // authorization rejection RLS was always going to make anyway.
  if (!["elder", "coordinator", "caregiver"].includes(membership!.role)) {
    return res.status(403).json({ error: "your role cannot record check-ins" });
  }
  const b = req.body ?? {};
  if (!MOODS.has(b.mood)) return res.status(400).json({ error: "mood must be good|ok|hard" });
  const visibility = VIS.has(b.visibility) ? b.visibility : "family";
  const isProxy = membership!.role !== "elder";
  const stagingPath: string | null = typeof b.staging_path === "string" ? b.staging_path : null;
  // Full allow-list match, not just a prefix check: `startsWith` alone
  // admits e.g. "<cid>/staging/../../<otherCid>/staging/x" today (harmless
  // only because uploadStaging/promoteStaging are still Part-1c stubs with
  // no real filesystem/Storage path underneath them yet).
  const STAGING_PATH = new RegExp(`^${cid}/staging/[A-Za-z0-9._-]+$`);
  if (stagingPath && !STAGING_PATH.test(stagingPath)) {
    return res.status(400).json({ error: "staging_path does not belong to this circle" });
  }
  const out = await withUserTxn(claims, async (q) => {
    let audioPath: string | null = null;
    if (stagingPath) audioPath = await promoteStaging(stagingPath);
    const circle = (await q.query(
      `select to_char((now() at time zone c.timezone)::date, 'YYYY-MM-DD') as today, c.elder_lang
       from public.circles c where c.id = $1`, [cid])).rows[0];
    const cin = await q.query(
      `insert into public.checkins
         (circle_id, occurred_on, mood, spoken_lang, visibility, recorded_by, is_proxy, created_via)
       values ($1, $2, $3, $4, $5, $6, $7, 'live') returning id`,
      [cid, b.occurred_on || circle.today, b.mood, resolveSpokenLang(b.spoken_lang, circle.elder_lang),
       visibility, claims.sub, isProxy],
    );
    await q.query(
      `insert into public.checkin_content (checkin_id, circle_id, visibility, recorded_by, is_proxy,
         transcript, translation, audio_path)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [cin.rows[0].id, cid, visibility, claims.sub, isProxy,
       String(b.transcript ?? ""), String(b.translation ?? b.transcript ?? ""), audioPath],
    );
    return cin.rows[0].id as string;
  });
  res.status(201).json({ id: out });
}));

checkinsRouter.patch("/checkins/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const cid = req.params.cid;
  const visibility = req.body?.visibility;
  if (!VIS.has(visibility)) return res.status(400).json({ error: "bad visibility" });
  const r = await withUserTxn(req.claims, (q) =>
    q.query(
      `update public.checkins set visibility = $3 where id = $1 and circle_id = $2 returning id`,
      [req.params.id, cid, visibility],
    ),
  );
  if (r.rowCount === 0) return res.status(403).json({ error: "cannot change this check-in" });
  res.json({ id: req.params.id, visibility });
}));

checkinsRouter.delete("/checkins/:id", asyncHandler<AuthedRequest>(async (req, res) => {
  const r = await withUserTxn(req.claims, (q) =>
    q.query(`delete from public.checkins where id = $1 and circle_id = $2 returning id`,
      [req.params.id, req.params.cid]),
  );
  if (r.rowCount === 0) return res.status(403).json({ error: "cannot delete this check-in" });
  res.status(204).end();
}));

checkinsRouter.get("/checkins/:id/audio", asyncHandler<AuthedRequest>(async (req, res) => {
  const row = await withUserTxn(req.claims, (q) =>
    q.query(
      `select cc.audio_path from public.checkin_content cc
       where cc.checkin_id = $1 and cc.circle_id = $2`, [req.params.id, req.params.cid],
    ),
  );
  const path = row.rows[0]?.audio_path;
  if (!path) return res.status(403).json({ error: "not permitted" });
  const url = await signedUrl(path, 120);
  res.json({ url, expires_at: new Date(Date.now() + 120_000).toISOString() });
}));
