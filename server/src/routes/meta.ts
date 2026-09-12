import { Router } from "express";
export const metaRouter = Router();
metaRouter.get("/health", (_req, res) => res.json({ ok: true }));
