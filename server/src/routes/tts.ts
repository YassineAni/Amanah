import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { perUserThrottle } from "../auth/circle.js";
import { env } from "../config.js";
import { asyncHandler } from "../http/asyncHandler.js";

const TTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../audio/tts");
mkdirSync(TTS_DIR, { recursive: true });

export const ttsRouter = Router();

ttsRouter.post("/tts", requireAuth, asyncHandler<AuthedRequest>(async (req, res) => {
  const { claims } = req;
  const text = String(req.body?.text ?? "").trim();
  const lang = String(req.body?.lang ?? "en");
  if (!text) return res.status(400).json({ error: "text required" });
  if (text.length > 800) return res.status(400).json({ error: "text too long (max 800)" });
  if (!perUserThrottle(`tts:${claims.sub}`, 60, 5 * 60_000)) {
    return res.status(429).json({ error: "too many read-aloud requests" });
  }
  const hash = createHash("sha1").update(`nova|${lang}|${text}`).digest("hex");
  const file = resolve(TTS_DIR, `${hash}.mp3`);
  if (existsSync(file)) { res.type("audio/mpeg").send(readFileSync(file)); return; }
  if (!env.OPENAI_API_KEY) return res.status(502).json({ error: "OPENAI_API_KEY not set" });

  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "nova", input: text, response_format: "mp3" }),
  });
  if (!r.ok) return res.status(502).json({ error: `tts failed (${r.status})` });
  const buf = Buffer.from(await r.arrayBuffer());
  try { writeFileSync(file, buf); } catch { /* cache best-effort */ }
  res.type("audio/mpeg").send(buf);
}));
