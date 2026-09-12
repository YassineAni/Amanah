import pg from "pg";
import { env } from "../config.js";

export type Claims = { sub: string; email: string; role: string; [k: string]: unknown };
export type Querier = Pick<pg.PoolClient, "query">;

// Direct connection. keepAlive so a long-idle machine keeps the socket.
export const appPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10, keepAlive: true });
export const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL_ADMIN, max: 4 });

// node-postgres emits 'error' on the Pool itself when an IDLE client's
// connection dies server-side (a DB restart/failover, a network blip) —
// unlike a query-time error, nothing is awaiting that client, so with no
// listener here it's an unhandled 'error' event, which crashes the whole
// process (Node's default behavior), not just the one request. Logging
// and swallowing it is correct: the pool already discards the broken
// client and opens a fresh one on the next .connect(). Caught by CI: a
// full-suite run passed 31/31 files but still exited 1, because
// bypass.test.ts's migration-idempotency check runs `supabase db reset`
// twice mid-suite, restarting Postgres out from under any connection
// other test files had left idle in these pools.
appPool.on("error", (err) => console.error("appPool: idle client error", err));
adminPool.on("error", (err) => console.error("adminPool: idle client error", err));

export async function withUserTxn<T>(
  claims: Claims,
  fn: (q: Querier) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    // $1 BOUND — never interpolated. set_config(..., true) == SET LOCAL.
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.query("discard all").catch(() => {});
    client.release();
  }
}

export async function withAdminTxn<T>(fn: (q: Querier) => Promise<T>): Promise<T> {
  const client = await adminPool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
