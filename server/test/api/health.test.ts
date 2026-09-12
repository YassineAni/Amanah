import { expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../../src/http/app.js";

test("GET /api/health", async () => {
  const res = await request(createApp()).get("/api/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true });
});
