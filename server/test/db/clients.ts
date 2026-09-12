import { execSync } from "node:child_process";
import { Client } from "pg";
import { SignJWT } from "jose";

// Local dev connection strings. Ports are the winnat-remapped 541xx set
// supabase/config.toml pins (spec §10 D-log addendum / 1b handoff invariant
// #10). CI reads that same committed config.toml via `supabase start`, so
// today these ports match CI too — CI does NOT set DATABASE_URL/SUPABASE_URL
// etc. as real env vars (see .github/workflows/db.yml). Exported so the 1b
// vitest env-setup (test/setup-env.ts) has ONE source for these, instead of
// a second hardcoded copy — if config.toml's ports are ever forked
// per-environment, only this file needs to change.
export const ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:54122/postgres";
export const APP_URL = "postgresql://app_authenticated:app_authenticated@127.0.0.1:54122/postgres";
export const API_URL = "http://127.0.0.1:54121";
// Local Supabase fixed dev secret (supabase/config.toml [auth].jwt_secret default).
export const JWT_SECRET_STRING =
  "super-secret-jwt-token-with-at-least-32-characters-long";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);

// The classic Supabase demo anon key. Kept as a fallback, but THIS CLI
// version signs a different anon JWT (the hardcoded one 401s against the
// running Kong/PostgREST), so resolve the real one from `supabase status`
// once at module load and fall back to the constant only if that fails.
const ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE";

function statusEnv(): string {
  return execSync("npx supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function resolveAnonKey(): string {
  try {
    const m = statusEnv().match(/ANON_KEY="?([^"\r\n]+)"?/);
    const key = m?.[1]?.trim();
    return key && key.length > 0 ? key : ANON_KEY_FALLBACK;
  } catch {
    return ANON_KEY_FALLBACK;
  }
}

export const ANON_KEY = resolveAnonKey();

// The service-role key is a per-project signed JWT, NOT a static demo
// constant like the anon key — there is no safe fallback for it. Real
// storage.audio.ts calls (Part 1c) authenticate to the local Storage
// container with this key; the placeholder string setup-env.ts used to
// inject ("test-service-role-key") 401s at the first store().upload(),
// so this resolves the real key the same way resolveAnonKey() does.
function resolveServiceRoleKey(): string {
  const m = statusEnv().match(/SERVICE_ROLE_KEY="?([^"\r\n]+)"?/);
  const key = m?.[1]?.trim();
  if (!key) {
    throw new Error(
      "could not resolve SERVICE_ROLE_KEY from `npx supabase status -o env` — is the local stack running (`npx supabase start`)?",
    );
  }
  return key;
}

export const SERVICE_ROLE_KEY = resolveServiceRoleKey();

export function admin(): Client {
  return new Client({ connectionString: ADMIN_URL });
}

/** app_authenticated with NO request.jwt.claims — proves fail-closed. */
export async function rawNoClaims(): Promise<Client> {
  const c = new Client({ connectionString: APP_URL });
  await c.connect();
  return c;
}

// Cache: userId -> email. Looked up ONCE via an admin (BYPASSRLS) connection —
// never on the RLS-subject connection, where a pre-claims profiles read would
// return nothing and the minted claims would carry a sentinel email.
const emailCache = new Map<string, string>();
async function emailFor(userId: string): Promise<string> {
  const hit = emailCache.get(userId);
  if (hit) return hit;
  const a = new Client({ connectionString: ADMIN_URL });
  await a.connect();
  try {
    const r = await a.query<{ email: string }>(
      "select email::text as email from public.profiles where id = $1", [userId],
    );
    const email = r.rows[0]?.email ?? "unknown@example.com";
    emailCache.set(userId, email);
    return email;
  } finally {
    await a.end();
  }
}

async function withClaims<T>(
  userId: string, fn: (c: Client) => Promise<T>, finish: "rollback" | "commit",
): Promise<T> {
  const email = await emailFor(userId);
  const c = new Client({ connectionString: APP_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", email }),
    ]);
    const out = await fn(c);
    await c.query(finish);
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

/** app_authenticated inside a txn with claims set for `userId`. Rolls back. */
export const asUser = <T>(userId: string, fn: (c: Client) => Promise<T>) =>
  withClaims(userId, fn, "rollback");

/** Same, but COMMITs — for write-matrix tests that need committed state.
 *  The caller must reload the fixture per test (beforeEach). */
export const asUserCommitted = <T>(userId: string, fn: (c: Client) => Promise<T>) =>
  withClaims(userId, fn, "commit");

/** app_authenticated in an OPEN transaction with `userId`'s claims set.
 *  The CALLER owns the client: run statements, then commit()/rollback() and
 *  end(). Unlike asUser (always rolls back) and asUserCommitted (commits when
 *  the callback returns), this can hold two RLS-subject transactions open
 *  across an interleaving — which is the only way to observe a row lock. */
export async function rawAsUser(userId: string): Promise<Client> {
  const email = await emailFor(userId);
  const c = new Client({ connectionString: APP_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated", email }),
    ]);
    return c;
  } catch (e) {
    await c.end().catch(() => {});
    throw e;
  }
}

export async function mintJwt(claims: { sub: string; email: string }): Promise<string> {
  return new SignJWT({ ...claims, role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);
}

export function postgrest(path: string, jwt: string): Promise<Response> {
  return fetch(API_URL + path, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
}
