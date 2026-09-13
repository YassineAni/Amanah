// Vitest setup — runs before every test file's module graph loads, so
// src/config.ts sees these when its `required(...)` runs.
//
// Local dev and CI both read the same committed supabase/config.toml (the
// winnat-remapped 541xx ports — handoff invariant #10), so they already
// agree today; CI does not set DATABASE_URL/SUPABASE_URL as real env vars.
// The port constants live only in test/db/clients.ts — this file is the one
// place that would need to change if config.toml's ports were ever forked
// per-environment, and src/config.ts keeps the plan's literal default-port
// fallbacks (used only if this setup file is bypassed).
import { ADMIN_URL, API_URL, APP_URL, JWT_SECRET_STRING, SERVICE_ROLE_KEY } from "./db/clients.js";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= APP_URL;
process.env.DATABASE_URL_ADMIN ??= ADMIN_URL;
process.env.SUPABASE_URL ??= API_URL;
process.env.SUPABASE_JWT_SECRET ??= JWT_SECRET_STRING;
// A real per-project key, resolved from `supabase status` (see clients.ts) —
// not a placeholder. server/src/storage/audio.ts (Part 1c) authenticates
// to the local Storage container with this key via supabaseAdmin; a fake
// string 401s at the first upload() instead of failing at import time.
process.env.SUPABASE_SERVICE_ROLE_KEY ??= SERVICE_ROLE_KEY;
