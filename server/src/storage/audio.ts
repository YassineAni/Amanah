import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { adminPool } from "../db/pool.js";

const BUCKET = "audio";
const store = () => supabaseAdmin.storage.from(BUCKET);

// Standard MIME subtypes for the extensions checkins.ts's extFor() produces.
// uploadStaging previously built `audio/${ext}` directly from that
// extension, which yields non-registered subtypes for two of them
// ("audio/mp3", "audio/m4a") — harmless to store, but wrong as the
// Content-Type a signed URL later serves to a real <audio> player.
const CONTENT_TYPE: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

export async function uploadStaging(cid: string, buf: Buffer, ext: string): Promise<string> {
  const cleanExt = ext.replace(/^\./, "");
  const key = `${cid}/staging/${randomUUID()}.${cleanExt}`;
  const { error } = await store().upload(key, buf, {
    contentType: CONTENT_TYPE[cleanExt] ?? `audio/${cleanExt}`,
    upsert: false,
  });
  if (error) throw new Error(`audio upload failed: ${error.message}`);
  return key;
}

export async function promoteStaging(stagingPath: string): Promise<string> {
  // Suffix is restricted to the same allow-list checkins.ts already enforces
  // at the route level (no "/" — rejects path traversal like
  // "<cid>/staging/../../otherCid/x") so this module is safe on its own
  // terms, not only because of caller discipline.
  const m = stagingPath.match(/^([0-9a-f-]{36})\/staging\/([A-Za-z0-9._-]+)$/i);
  if (!m) throw new Error("not a staging path");
  const dest = `${m[1]}/${m[2]}`;
  const { error: copyErr } = await store().copy(stagingPath, dest);
  if (copyErr) throw new Error(`promote failed: ${copyErr.message}`);
  const { error: removeErr } = await store().remove([stagingPath]);
  if (removeErr) {
    // Non-fatal: the promoted copy already exists and is the one that
    // matters — a stale staging duplicate just lingers until sweepOrphans
    // catches it. Still worth a loud log; silently swallowing this was the
    // Task-2 draft's behavior and hid a real (if low-severity) leak.
    console.error(`promoteStaging: failed to remove staging object ${stagingPath}`, removeErr);
  }
  return dest;
}

export async function signedUrl(path: string, ttlSec: number): Promise<string> {
  const { data, error } = await store().createSignedUrl(path, ttlSec);
  if (error || !data) throw new Error(`sign failed: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

export async function deleteCircleAudio(cid: string): Promise<void> {
  for (const prefix of [`${cid}`, `${cid}/staging`]) {
    const { data, error } = await store().list(prefix, { limit: 1000 });
    if (error) {
      // This runs after the circle's row is already gone (withAdminTxn
      // committed in the caller) — there is no later chance to retry. A
      // silently-discarded list() error here previously meant "circle
      // deleted" while its audio silently survived with no error anywhere.
      // Throw loudly instead: at minimum this surfaces as a 500 the caller
      // (and its logs) can act on, rather than a clean 204 that lied.
      throw new Error(`deleteCircleAudio: list(${prefix}) failed: ${error.message}`);
    }
    const keys = (data ?? []).map((o) => `${prefix}/${o.name}`);
    if (keys.length) {
      const { error: removeErr } = await store().remove(keys);
      if (removeErr) throw new Error(`deleteCircleAudio: remove(${prefix}) failed: ${removeErr.message}`);
    }
  }
}

// Folder pseudo-entries from Storage's list() come back with id: null;
// real objects have a truthy id (a uuid) — verified empirically against
// the local Storage API before relying on it here (folders/files are not
// otherwise distinguishable in the response shape).
export async function sweepOrphans(olderThanHours = 24): Promise<{ deleted: number }> {
  const cutoff = Date.now() - olderThanHours * 3_600_000;
  const referenced = new Set<string>(
    (await adminPool.query(`select audio_path from public.checkin_content where audio_path is not null`))
      .rows.map((r) => r.audio_path as string),
  );
  let deleted = 0;
  // one level of circle folders
  const { data: circles, error: listCirclesErr } = await store().list("", { limit: 10_000 });
  if (listCirclesErr) throw new Error(`sweepOrphans: list('') failed: ${listCirclesErr.message}`);
  for (const dir of circles ?? []) {
    if (dir.id) continue; // files at root are unexpected; skip
    for (const prefix of [dir.name, `${dir.name}/staging`]) {
      const { data: objs, error: listErr } = await store().list(prefix, { limit: 10_000 });
      if (listErr) {
        // Don't let one bad prefix silently truncate the sweep — a listing
        // failure previously just produced an empty page (data ?? []) with
        // no signal at all, so a Storage hiccup looked identical to "this
        // circle has nothing stale".
        console.error(`sweepOrphans: list(${prefix}) failed, skipping`, listErr);
        continue;
      }
      const stale = (objs ?? [])
        .filter((o) => o.id) // real objects only
        // Missing timestamp defaults to "now" (not stale), not epoch
        // ("ancient" => always eligible). This is a destructive job over
        // real elder audio — an ambiguous/missing timestamp should err
        // toward NOT deleting, not toward deleting.
        .filter((o) => new Date(o.created_at ?? o.updated_at ?? Date.now()).getTime() < cutoff)
        .map((o) => `${prefix}/${o.name}`)
        .filter((key) => !referenced.has(key));
      if (stale.length) {
        const { error: removeErr } = await store().remove(stale);
        if (removeErr) {
          console.error(`sweepOrphans: remove(${prefix}) failed`, removeErr);
          continue; // don't count objects that may not actually be gone
        }
        deleted += stale.length;
      }
    }
  }
  return { deleted };
}
