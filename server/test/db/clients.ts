import { execSync } from "node:child_process";
import { Client } from "pg";
import { SignJWT } from "jose";

const ADMIN_URL = "postgresql://postgres:postgres@127.0.0.1:54122/postgres";
const APP_URL = "postgresql://app_authenticated:app_authenticated@127.0.0.1:54122/postgres";
const API_URL = "http://127.0.0.1:54121";
// Local Supabase fixed dev secret (supabase/config.toml [auth].jwt_secret default).
const JWT_SECRET = new TextEncoder().encode(
  "super-secret-jwt-token-with-at-least-32-characters-long",
);

// The classic Supabase demo anon key. Kept as a fallback, but THIS CLI
// version signs a different anon JWT (the hardcoded one 401s against the
// running Kong/PostgREST), so resolve the real one from `supabase status`
// once at module load and fall back to the constant only if that fails.
const ANON_KEY_FALLBACK =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWRlbW8iLCJpYXQiOjE2NDE3NjkyMDAsImV4cCI6MTc5OTUzNTYwMH0.dc_X5iR_VP_qT0zsiyj_I_OZ2T9FtRU2BBNWN8Bu4GE";

function resolveAnonKey(): string {
  try {
    const env = execSync("npx supabase status -o env", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = env.match(/ANON_KEY="?([^"\r\n]+)"?/);
    const key = m?.[1]?.trim();
    return key && key.length > 0 ? key : ANON_KEY_FALLBACK;
  } catch {
    return ANON_KEY_FALLBACK;
  }
}

export const ANON_KEY = resolveAnonKey();

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
