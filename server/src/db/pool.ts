import pg from "pg";
import { env } from "../config.js";

export type Claims = { sub: string; email: string; role: string; [k: string]: unknown };
export type Querier = Pick<pg.PoolClient, "query">;

// Direct connection. keepAlive so a long-idle machine keeps the socket.
export const appPool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10, keepAlive: true });
export const adminPool = new pg.Pool({ connectionString: env.DATABASE_URL_ADMIN, max: 4 });

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
