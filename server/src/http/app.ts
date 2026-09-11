import cors from "cors";
import express from "express";
import { env } from "../config.js";
import { metaRouter } from "../routes/meta.js";
import { accountRouter } from "../routes/account.js";
import { circlesRouter } from "../routes/circles.js";
import { invitesRouter } from "../routes/invites.js";
import { checkinsRouter } from "../routes/checkins.js";

export function createApp(): express.Express {
  const app = express();
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", metaRouter);
  app.use("/api", accountRouter);
  app.use("/api", circlesRouter);
  app.use("/api", invitesRouter);
  app.use("/api/circles/:cid", checkinsRouter);
  // subsequent tasks add:
  // careSignalRouter, shiftsRouter, planRouter, routineRouter,
  // ttsRouter — each mounted here.

  // Error shape. Handlers throw Object.assign(new Error(msg), { status })
  // for intentional 4xx responses (e.g. a 409 from a guard trigger) — that
  // message is meant for the client, so it's returned as-is. A raw Postgres
  // 42501 (insufficient_privilege — an RLS/grant WITH CHECK denial that
  // wasn't caught by an app-level role gate first, e.g. a route that forgot
  // one) is a routine authorization rejection, not a bug, so it maps to 403
  // rather than falling into the generic-500 branch below; this is a
  // backstop, not a substitute for each write route's own role check.
  // Anything else without a recognised status is a genuine unexpected
  // failure (a raw DB error, a bug): log it server-side and return a
  // generic message rather than leaking internals (constraint/column/table
  // names, library text) to the caller.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const pgCode = (err as { code?: unknown })?.code;
    const explicitStatus = typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : undefined;
    const status = explicitStatus ?? (pgCode === "42501" ? 403 : 500);
    if (status >= 500) {
      console.error("unhandled request error:", err);
      res.status(status).json({ error: "internal error" });
    } else if (pgCode === "42501" && explicitStatus === undefined) {
      res.status(403).json({ error: "not permitted" });
    } else {
      res.status(status).json({ error: err instanceof Error ? err.message : "request failed" });
    }
  });
  return app;
}
