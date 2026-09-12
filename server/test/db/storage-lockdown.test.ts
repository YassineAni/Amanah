import { expect, test } from "vitest";
import { admin } from "./clients.js";

// Pins the "audio" bucket's authorization boundary as an ongoing, CI-enforced
// check rather than trusting the migration comment alone (migration
// 20260912000001's own belt-and-braces sweep only runs once, at apply time —
// it does not stop a policy being added afterward, e.g. via Studio, or by a
// later migration that reintroduces one).
test("audio bucket is private with zero storage.objects policies", async () => {
  const c = admin();
  await c.connect();
  try {
    const bucket = await c.query(
      "select public from storage.buckets where id = 'audio'",
    );
    expect(bucket.rows).toHaveLength(1);
    expect(bucket.rows[0].public).toBe(false);

    const policies = await c.query(
      `select policyname from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and (
           coalesce(qual, '') ~* '\\mbucket_id\\M\\s*=\\s*''audio'''
           or coalesce(with_check, '') ~* '\\mbucket_id\\M\\s*=\\s*''audio'''
         )`,
    );
    expect(policies.rows).toEqual([]);
  } finally {
    await c.end();
  }
});
