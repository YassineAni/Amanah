import type { NextFunction, Response } from "express";
import { withUserTxn } from "../db/pool.js";
import type { AuthedRequest } from "./middleware.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireCircle(...roles: string[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const cid = req.params.cid;
    if (!cid || !UUID.test(cid)) return res.status(400).json({ error: "bad circle id" });
    const r = await withUserTxn(req.claims, (q) =>
      q.query(
        `select role, is_family_member from public.circle_members
         where circle_id = $1 and user_id = $2 and removed_at is null`,
        [cid, req.claims.sub],
      ),
    );
    const row = r.rows[0];
    if (!row) return res.status(403).json({ error: "not a member of this circle" });
    if (roles.length && !roles.includes(row.role)) {
      return res.status(403).json({ error: `requires role: ${roles.join(" or ")}` });
    }
    req.membership = { role: row.role, isFamilyMember: row.is_family_member };
    next();
  };
}

const buckets = new Map<string, number[]>();
export function perUserThrottle(userId: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(userId) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(userId, hits);
  return hits.length <= max;
}
