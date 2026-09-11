import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, TokenError } from "./verify.js";
import { withUserTxn, type Claims } from "../db/pool.js";

export type AuthedRequest = Request & {
  claims: Claims;
  membership?: { role: string; isFamilyMember: boolean };
};

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

export async function requireNoticeAccepted(req: Request, res: Response, next: NextFunction) {
  const { claims } = req as AuthedRequest;
  const r = await withUserTxn(claims, (q) =>
    q.query("select tos_accepted_at from public.profiles where id = $1", [claims.sub]),
  );
  if (!r.rows[0]?.tos_accepted_at) {
    return res.status(403).json({ error: "accept the privacy notice first", code: "notice_required" });
  }
  next();
}
