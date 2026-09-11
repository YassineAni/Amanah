import cors from "cors";
import express from "express";
import { env } from "../config.js";
import { metaRouter } from "../routes/meta.js";

export function createApp(): express.Express {
  const app = express();
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", metaRouter);
  // subsequent tasks add: accountRouter, circlesRouter, invitesRouter,
  // checkinsRouter, careSignalRouter, shiftsRouter, planRouter, routineRouter,
  // ttsRouter — each mounted here.

  // fallback error shape
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const msg = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: msg });
  });
  return app;
}
