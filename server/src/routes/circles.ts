import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withAdminTxn, withUserTxn } from "../db/pool.js";
import { asyncHandler } from "../http/asyncHandler.js";
import { deleteCircleAudio } from "../storage/audio.js";

export const circlesRouter = Router();

const TZ = new Set(Intl.supportedValuesOf("timeZone"));

circlesRouter.post(
  "/circles",
  requireAuth,
  requireNoticeAccepted,
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { claims } = req;
    const b = req.body ?? {};
    const elderName = String(b.elder_name ?? "").trim().slice(0, 120);
    const elderLang = String(b.elder_lang ?? "ar").trim().slice(0, 12);
    const timezone = String(b.timezone ?? "");
    if (!elderName) return res.status(400).json({ error: "elder_name required" });
    if (!TZ.has(timezone)) return res.status(400).json({ error: "invalid IANA timezone" });
    if (b.attestation !== true) {
      return res.status(400).json({ error: "attestation of care authority is required" });
    }

    let orgId: string | undefined = typeof b.org_id === "string" ? b.org_id : undefined;
    if (orgId) {
      const owned = await withUserTxn(claims, (q) =>
        q.query(`select 1 from public.organizations where id = $1 and owner_user_id = $2`,
          [orgId, claims.sub]),
      );
      if (owned.rowCount === 0) return res.status(403).json({ error: "not your organization" });
    }

    const circle = await withAdminTxn(async (q) => {
      if (!orgId) {
        const cap = await q.query(
          `select count(*)::int n from public.organizations where owner_user_id = $1`,
          [claims.sub]);
        if (cap.rows[0].n >= 10) throw Object.assign(new Error("organization limit reached"), { status: 409 });
        orgId = (await q.query(
          `insert into public.organizations (name, kind, owner_user_id)
           values ($1, 'family', $2) returning id`,
          [`${elderName}'s circle`, claims.sub])).rows[0].id;
      }
      const c = (await q.query(
        `insert into public.circles (org_id, name, elder_name, elder_lang, timezone)
         values ($1, $2, $2, $3, $4) returning *`,
        [orgId, elderName, elderLang, timezone])).rows[0];
      await q.query(
        `insert into public.circle_members (circle_id, user_id, role, is_family_member)
         values ($1, $2, 'coordinator', true)`,
        [c.id, claims.sub]);
      return c;
    });

    res.status(201).json({ circle });
  }),
);

circlesRouter.delete(
  "/circles/:cid",
  requireAuth, requireCircle("coordinator"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { claims } = req;
    const cid = req.params.cid;
    const owns = await withUserTxn(claims, (q) =>
      q.query(
        `select 1 from public.circles c join public.organizations o on o.id = c.org_id
         where c.id = $1 and o.owner_user_id = $2`, [cid, claims.sub],
      ),
    );
    if (owns.rowCount === 0) return res.status(403).json({ error: "only the org owner can delete a circle" });
    await withAdminTxn((q) => q.query(`delete from public.circles where id = $1`, [cid]));
    await deleteCircleAudio(cid);
    res.status(204).end();
  }),
);

// Closes a 1c gap: nothing in 1b let a client list a circle's roster
// (GET /api/me only returns the caller's own circles, not who else is in
// one) — the frontend's coordinator screen needs this for the
// caregiver-assignment dropdown and family/caregiver labeling.
circlesRouter.get(
  "/circles/:cid/members",
  requireAuth, requireCircle(),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const rows = await withUserTxn(req.claims, (q) =>
      q.query(
        `select m.user_id as id, p.full_name as name, m.role, m.is_family_member
         from public.circle_members m
         join public.profiles p on p.id = m.user_id
         where m.circle_id = $1 and m.removed_at is null
         order by m.joined_at`, [req.params.cid],
      ),
    );
    res.json(rows.rows);
  }),
);

circlesRouter.delete(
  "/circles/:cid/members/:userId",
  requireAuth, requireCircle("coordinator"),
  asyncHandler<AuthedRequest>(async (req, res, next) => {
    try {
      const r = await withUserTxn(req.claims, (q) =>
        q.query(
          `update public.circle_members set removed_at = now()
           where circle_id = $1 and user_id = $2 and removed_at is null returning id`,
          [req.params.cid, req.params.userId],
        ),
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "no such active member" });
      res.status(204).end();
    } catch (e: any) {
      if (/last coordinator|organization owner/i.test(e.message)) {
        return res.status(409).json({ error: e.message });
      }
      next(e);
    }
  }),
);
