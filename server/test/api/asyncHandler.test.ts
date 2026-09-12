import { expect, test } from "vitest";
import express from "express";
import request from "supertest";
import { asyncHandler } from "../../src/http/asyncHandler.js";

// Regression guard for the Task 1-5 review finding: an async Express 4
// handler/middleware that rejects with no try/catch becomes an unhandled
// promise rejection — which crashes the whole process, not just the one
// request, because Express never awaits it. asyncHandler must route the
// rejection to next(err) instead.
test("a rejecting async handler reaches the error middleware, not an unhandled rejection", async () => {
  const app = express();
  app.get(
    "/boom",
    asyncHandler(async () => {
      throw new Error("simulated DB failure");
    }),
  );
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  });

  const res = await request(app).get("/boom");
  expect(res.status).toBe(500);
  expect(res.body.error).toBe("simulated DB failure");
});

test("an async middleware that rejects before calling next() also reaches the error middleware", async () => {
  const app = express();
  app.use(
    asyncHandler(async () => {
      throw new Error("simulated middleware failure");
    }),
  );
  app.get("/never", (_req, res) => res.json({ reached: true }));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  });

  const res = await request(app).get("/never");
  expect(res.status).toBe(500);
  expect(res.body.error).toBe("simulated middleware failure");
});
