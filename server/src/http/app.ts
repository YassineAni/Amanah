import cors from "cors";
import express from "express";
import { env } from "../config.js";
import { metaRouter } from "../routes/meta.js";
import { accountRouter } from "../routes/account.js";
import { circlesRouter } from "../routes/circles.js";
import { invitesRouter } from "../routes/invites.js";

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
  // subsequent tasks add:
  // checkinsRouter, careSignalRouter, shiftsRouter, planRouter, routineRouter,
  // ttsRouter — each mounted here.

  // Error shape. Handlers throw Object.assign(new Error(msg), { status })
  // for intentional 4xx responses (e.g. a 409 from a guard trigger) — that
  // message is meant for the client, so it's returned as-is. Anything
  // without a recognised status is a genuine unexpected failure (a raw DB
  // error, a bug): log it server-side and return a generic message rather
  // than leaking internals (constraint/column/table names, library text)
  // to the caller.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : 500;
    if (status >= 500) {
      console.error("unhandled request error:", err);
      res.status(status).json({ error: "internal error" });
    } else {
      res.status(status).json({ error: err instanceof Error ? err.message : "request failed" });
    }
  });
  return app;
}
