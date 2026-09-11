import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, TokenError } from "./verify.js";
import { withUserTxn, type Claims } from "../db/pool.js";
import { asyncHandler } from "../http/asyncHandler.js";

export type AuthedRequest = Request & {
  claims: Claims;
  membership?: { role: string; isFamilyMember: boolean };
};

// Already fully self-contained (own try/catch, never rejects) — does not
// need asyncHandler, but is safe to compose with it if ever changed.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const raw = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!raw) return res.status(401).json({ error: "not signed in" });
  try {
    (req as AuthedRequest).claims = await verifyAccessToken(raw);
    next();
  } catch (e) {
    if (e instanceof TokenError) return res.status(401).json({ error: e.message });
    return res.status(401).json({ error: "auth failed" });
  }
}

export const requireNoticeAccepted = asyncHandler<AuthedRequest>(async (req, res, next) => {
  const { claims } = req;
  const r = await withUserTxn(claims, (q) =>
    q.query("select tos_accepted_at from public.profiles where id = $1", [claims.sub]),
  );
  if (!r.rows[0]?.tos_accepted_at) {
    return res.status(403).json({ error: "accept the privacy notice first", code: "notice_required" });
  }
  next();
});
