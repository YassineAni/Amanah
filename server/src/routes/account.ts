import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { withUserTxn } from "../db/pool.js";
import { asyncHandler } from "../http/asyncHandler.js";

export const accountRouter = Router();

accountRouter.get("/me", requireAuth, asyncHandler<AuthedRequest>(async (req, res) => {
  const { claims } = req;
  const data = await withUserTxn(claims, async (q) => {
    const profile = (await q.query(
      `select id, email, full_name, ui_lang, tos_accepted_at, privacy_notice_version
       from public.profiles where id = $1`, [claims.sub],
    )).rows[0];
    const circles = (await q.query(
      `select c.id, c.name, m.role, o.is_demo
       from public.circle_members m
       join public.circles c on c.id = m.circle_id
       join public.organizations o on o.id = c.org_id
       where m.user_id = $1 and m.removed_at is null and c.archived_at is null
       order by c.created_at`, [claims.sub],
    )).rows;
    return { profile, circles };
  });
  res.json(data);
}));

accountRouter.post("/me/accept-notice", requireAuth, asyncHandler<AuthedRequest>(async (req, res) => {
  const { claims } = req;
  const version = String((req.body?.version ?? "")).slice(0, 40);
  if (!version) return res.status(400).json({ error: "version required" });
  await withUserTxn(claims, (q) =>
    q.query(
      `update public.profiles set tos_accepted_at = now(), privacy_notice_version = $2
       where id = $1`, [claims.sub, version],
    ),
  );
  res.status(204).end();
}));
