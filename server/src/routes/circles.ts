import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { withAdminTxn, withUserTxn } from "../db/pool.js";
import { asyncHandler } from "../http/asyncHandler.js";

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
