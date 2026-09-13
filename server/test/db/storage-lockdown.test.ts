import { expect, test } from "vitest";
import { admin } from "./clients.js";

// Pins the "audio" bucket's authorization boundary as an ongoing, CI-enforced
// check rather than trusting the migration comment alone (migration
// 20260912000001's own belt-and-braces sweep only runs once, at apply time —
// it does not stop a policy being added afterward, e.g. via Studio, or by a
// later migration that reintroduces one).
//
// Checked by ROLE, not by matching bucket_id text in qual/with_check — a
// text-matching version of this check missed two real cases (verified
// empirically): a policy with no scoping predicate (`using (true)`, applies
// to every bucket including this one), and a policy created with no `TO`
// clause, which Postgres reports as roles = {public} rather than
// {anon,authenticated}. Checking for 'public' directly closes that gap.
test("audio bucket is private with zero anon/authenticated/public policies", async () => {
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
         and (roles && array['anon', 'authenticated', 'public']::name[])`,
    );
    expect(policies.rows).toEqual([]);
  } finally {
    await c.end();
  }
});
