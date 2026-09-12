import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth, requireNoticeAccepted, type AuthedRequest } from "../auth/middleware.js";
import { requireCircle, perUserThrottle } from "../auth/circle.js";
import { withAdminTxn, withUserTxn } from "../db/pool.js";
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

    // Validate the whole batch before writing anything.
    const parsed: { email: string; role: string; isFam: boolean; token: string }[] = [];
    for (const raw of items) {
      const email = String(raw.email ?? "").trim().toLowerCase();
      const role = String(raw.role ?? "");
      const isFam = raw.is_family_member !== false;
      if (!EMAIL.test(email)) return res.status(400).json({ error: `bad email: ${raw.email}` });
      if (!ROLES.has(role)) return res.status(400).json({ error: `bad role: ${role}` });
      parsed.push({ email, role, isFam, token: (randomUUID() + randomUUID()).replace(/-/g, "") });
    }

    // Insert the whole batch in ONE transaction: a duplicate-pending
    // conflict on item N rolls back items 1..N-1 too, instead of leaving a
    // partially-inserted (and partially-emailed) batch the client has no
    // clean way to retry — a per-item txn+email loop can silently strand a
    // completed invite (row inserted, email already sent) behind a 409 for
    // the request as a whole.
    let rows: { id: string; email: string; role: string }[];
    try {
      rows = await withUserTxn(claims, async (q) => {
        const out: { id: string; email: string; role: string }[] = [];
        for (const p of parsed) {
          out.push((await q.query(
            `insert into public.invites (circle_id, email, role, is_family_member, token, invited_by)
             values ($1,$2,$3,$4,$5,$6) returning id, email, role`,
            [cid, p.email, p.role, p.isFam, p.token, claims.sub],
          )).rows[0]);
        }
        return out;
      });
    } catch (e: any) {
      if (String(e?.message).includes("invites_one_pending_per_email")) {
        // The whole txn rolled back — nothing from this batch was inserted.
        return res.status(409).json({ error: "one or more emails already have a pending invite" });
      }
      throw e;
    }

    // Only send email once every row is durably committed. A delivery
    // failure partway through is a resend problem, not a data-integrity
    // one — the rows already exist and the client got a 201 with them.
    for (const p of parsed) {
      await supabaseAdmin.auth.admin.inviteUserByEmail(p.email, {
        data: { circle_id: cid, role: p.role, is_family_member: p.isFam },
        redirectTo: `${env.APP_ORIGIN}/invite/${p.token}`,
      });
    }
    res.status(201).json({ invites: rows });
  }),
);

invitesRouter.get(
  "/invites/:token",
  asyncHandler(async (req, res) => {
    const ip = req.ip ?? "anon";
    if (!perUserThrottle(`invite:${ip}`, 30, 5 * 60_000)) {
      return res.status(429).json({ error: "too many requests" });
    }
    const row = await withAdminTxn((q) =>
      q.query(
        `select c.name as circle_name, p.full_name as inviter_name, i.role,
                i.accepted_at, i.expires_at
         from public.invites i
         join public.circles c on c.id = i.circle_id
         join public.profiles p on p.id = i.invited_by
         where i.token = $1`, [req.params.token],
      ),
    );
    const r = row.rows[0];
    if (!r || r.accepted_at || new Date(r.expires_at) < new Date()) {
      return res.status(410).json({ error: "this invite is no longer valid" });
    }
    res.json({ circle_name: r.circle_name, inviter_name: r.inviter_name, role: r.role });
  }),
);

invitesRouter.post(
  "/invites/:token/accept",
  requireAuth,
  // Intentionally NOT asyncHandler-wrapped: the whole body below is inside
  // one try/catch that always resolves the response itself (never lets a
  // rejection escape) and independently applies the same
  // genericize-5xx/pass-through-4xx rule app.ts's error middleware does.
  // If this handler ever grows a code path after/outside that try/catch,
  // wrap it with asyncHandler like every other route in this codebase.
  async (req, res) => {
    const { claims } = req as AuthedRequest;
    try {
      const circleId = await withAdminTxn(async (q) => {
        const swap = await q.query(
          `update public.invites set accepted_at = now()
           where token = $1 and accepted_at is null and now() < expires_at
           returning circle_id, email, role, is_family_member`, [req.params.token],
        );
        if (swap.rowCount === 0) throw Object.assign(new Error("invite not valid"), { status: 410 });
        const inv = swap.rows[0];
        if (String(inv.email).toLowerCase() !== String(claims.email).toLowerCase()) {
          throw Object.assign(new Error("this invite was sent to a different email"), { status: 403 });
        }
        // upsert / un-remove membership. Explicit select-then-write — no
        // ON CONFLICT against a partial index, no error-string matching. The
        // whole handler is one adminPool transaction, so this is atomic.
        const existing = await q.query(
          `select id, removed_at from public.circle_members
           where circle_id = $1 and user_id = $2`,
          [inv.circle_id, claims.sub],
        );
        if (existing.rowCount === 0) {
          await q.query(
            `insert into public.circle_members (circle_id, user_id, role, is_family_member, invited_by)
             values ($1, $2, $3, $4, $5)`,
            [inv.circle_id, claims.sub, inv.role, inv.is_family_member, claims.sub],
          );
        } else if (existing.rows[0].removed_at !== null) {
          // re-invite of a soft-removed member: un-remove + set the new role
          await q.query(
            `update public.circle_members
             set removed_at = null, role = $2, is_family_member = $3
             where id = $1`,
            [existing.rows[0].id, inv.role, inv.is_family_member],
          );
        } else {
          throw Object.assign(new Error("already a member of this circle"), { status: 409 });
        }
        if (inv.role === "elder") {
          const set = await q.query(
            `update public.circles set elder_user_id = $2
             where id = $1 and elder_user_id is null returning id`,
            [inv.circle_id, claims.sub]);
          if (set.rowCount === 0) {
            throw Object.assign(new Error("this circle already has an elder"), { status: 409 });
          }
        }
        return inv.circle_id as string;
      });
      res.json({ circle_id: circleId });
    } catch (e: any) {
      // Same rule as the app.ts error middleware: intentional 4xx errors
      // above carry .status and a client-meant message; anything else is
      // unexpected — log it, don't leak it.
      const status = typeof e?.status === "number" ? e.status : 500;
      if (status >= 500) {
        console.error("invite accept failed:", e);
        res.status(status).json({ error: "internal error" });
      } else {
        res.status(status).json({ error: e.message });
      }
    }
  },
);
