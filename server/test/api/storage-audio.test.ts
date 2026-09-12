import { afterAll, expect, test } from "vitest";
import { uploadStaging, promoteStaging, signedUrl, deleteCircleAudio, sweepOrphans } from "../../src/storage/audio.js";
import { randomUUID } from "node:crypto";
import { admin } from "../db/clients.js";

const cid = randomUUID();
afterAll(() => deleteCircleAudio(cid));

test("upload -> promote -> sign round trip", async () => {
  const staging = await uploadStaging(cid, Buffer.from("fake-audio"), "webm");
  expect(staging).toMatch(new RegExp(`^${cid}/staging/`));
  const promoted = await promoteStaging(staging);
  expect(promoted).toMatch(new RegExp(`^${cid}/[0-9a-f-]+\\.webm$`));
  const url = await signedUrl(promoted, 120);
  expect(url).toContain("token=");
});

test("sweepOrphans deletes an unreferenced staging object", async () => {
  await uploadStaging(cid, Buffer.from("orphan"), "webm");
  // olderThanHours = 0 -> everything unreferenced is stale
  const { deleted } = await sweepOrphans(0);
  expect(deleted).toBeGreaterThanOrEqual(1);
});

// sweepOrphans is a scheduled job that can permanently destroy real elder
// audio. Deleting an unreferenced object is the easy half to get right;
// this pins the half that actually matters — a promoted object that
// checkin_content.audio_path still points to must survive, even though by
// age alone (olderThanHours = 0) it's exactly as eligible as the orphan
// above. Uses `cid` itself as the circles.id, so the object key's
// "<circle_id>/..." prefix satisfies checkin_content's own
// audio_path-must-match-circle_id check constraint, same as production
// data — not a relaxed/fake shape.
test("sweepOrphans preserves a referenced (promoted) object", async () => {
  const staging = await uploadStaging(cid, Buffer.from("keep-me"), "webm");
  const promoted = await promoteStaging(staging);

  const c = admin();
  await c.connect();
  const userId = randomUUID();
  const orgId = randomUUID();
  const checkinId = randomUUID();
  try {
    // Minimal valid chain: auth.users (trigger creates the matching
    // profiles row) -> organizations -> circles (id = cid) -> checkins ->
    // checkin_content.audio_path = promoted. No circle_members row is
    // needed — this goes through the admin (BYPASSRLS) connection
    // directly, not withUserTxn, so circle-membership RLS never applies.
    await c.query(
      `insert into auth.users
         (id, instance_id, aud, role, email, encrypted_password,
          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $2,'',now(),now(),'{}','{}')`,
      [userId, `sweep-test-${userId}@example.com`],
    );
    await c.query(
      `insert into public.organizations (id, name, kind, owner_user_id)
       values ($1, 'sweep-test-org', 'family', $2)`,
      [orgId, userId],
    );
    await c.query(
      `insert into public.circles (id, org_id, name, elder_name, elder_lang, timezone)
       values ($1, $2, 'sweep-test', 'Test Elder', 'en', 'UTC')`,
      [cid, orgId],
    );
    await c.query(
      `insert into public.checkins (id, circle_id, occurred_on, mood, spoken_lang, recorded_by, is_proxy, created_via)
       values ($1, $2, current_date, 'good', 'en', $3, false, 'live')`,
      [checkinId, cid, userId],
    );
    await c.query(
      `insert into public.checkin_content
         (checkin_id, circle_id, visibility, recorded_by, is_proxy, transcript, translation, audio_path)
       values ($1, $2, 'family', $3, false, 'test', 'test', $4)`,
      [checkinId, cid, userId, promoted],
    );

    await sweepOrphans(0);

    // Still there: a signed URL can still be minted for it.
    const url = await signedUrl(promoted, 60);
    expect(url).toContain("token=");
  } finally {
    // Explicit, ordered cleanup (not relying on unverified cascade
    // behavior) — leaf tables first, auth.users last.
    await c.query(`delete from public.checkin_content where checkin_id = $1`, [checkinId]).catch(() => {});
    await c.query(`delete from public.checkins where id = $1`, [checkinId]).catch(() => {});
    await c.query(`delete from public.circles where id = $1`, [cid]).catch(() => {});
    await c.query(`delete from public.organizations where id = $1`, [orgId]).catch(() => {});
    await c.query(`delete from auth.users where id = $1`, [userId]).catch(() => {});
    await c.end();
  }
});
