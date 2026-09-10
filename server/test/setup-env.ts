// Vitest setup — runs before every test file's module graph loads, so
// src/config.ts sees these when its `required(...)` runs.
//
// Local dev uses the winnat-remapped 541xx ports (handoff invariant #10). CI
// runs the stack on Supabase defaults and sets DATABASE_URL / SUPABASE_URL /
// etc. as real env vars — the `??=` below leaves those untouched. The port
// constants live only in test/db/clients.ts; src/config.ts keeps the plan's
// default-port test fallbacks and never diverges local-vs-CI.
import { ADMIN_URL, API_URL, APP_URL, JWT_SECRET_STRING } from "./db/clients.js";

process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= APP_URL;
process.env.DATABASE_URL_ADMIN ??= ADMIN_URL;
process.env.SUPABASE_URL ??= API_URL;
process.env.SUPABASE_JWT_SECRET ??= JWT_SECRET_STRING;
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
