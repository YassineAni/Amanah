import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle } from "../auth/circle.js";
import { withUserTxn } from "../db/pool.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { env } from "../config.js";
import { asyncHandler } from "../http/asyncHandler.js";

export const invitesRouter = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["coordinator", "caregiver", "family", "elder"]);

invitesRouter.post(
  "/circles/:cid/invites",
  requireAuth, requireNoticeAccepted, requireCircle("coordinator"),
  asyncHandler<AuthedRequest>(async (req, res) => {
    const { claims } = req;
    const cid = req.params.cid;
    const items = Array.isArray(req.body?.invites) ? req.body.invites : [];
    if (!items.length) return res.status(400).json({ error: "invites[] required" });

    const out: { id: string; email: string; role: string }[] = [];
    for (const raw of items) {
      const email = String(raw.email ?? "").trim().toLowerCase();
      const role = String(raw.role ?? "");
      const isFam = raw.is_family_member !== false;
      if (!EMAIL.test(email)) return res.status(400).json({ error: `bad email: ${raw.email}` });
      if (!ROLES.has(role)) return res.status(400).json({ error: `bad role: ${role}` });
      const token = (randomUUID() + randomUUID()).replace(/-/g, "");

      try {
        const row = await withUserTxn(claims, (q) =>
          q.query(
            `insert into public.invites (circle_id, email, role, is_family_member, token, invited_by)
             values ($1,$2,$3,$4,$5,$6) returning id, email, role`,
            [cid, email, role, isFam, token, claims.sub],
          ),
        );
        out.push(row.rows[0]);
      } catch (e: any) {
        if (String(e?.message).includes("invites_one_pending_per_email")) {
          return res.status(409).json({ error: `already invited: ${email}` });
        }
        throw e;
      }

      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { circle_id: cid, role, is_family_member: isFam },
        redirectTo: `${env.APP_ORIGIN}/invite/${token}`,
      });
    }
    res.status(201).json({ invites: out });
  }),
);
