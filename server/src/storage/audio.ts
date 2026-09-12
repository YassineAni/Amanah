import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { adminPool } from "../db/pool.js";

const BUCKET = "audio";
const store = () => supabaseAdmin.storage.from(BUCKET);

export async function uploadStaging(cid: string, buf: Buffer, ext: string): Promise<string> {
  const key = `${cid}/staging/${randomUUID()}.${ext.replace(/^\./, "")}`;
  const { error } = await store().upload(key, buf, { contentType: `audio/${ext}`, upsert: false });
  if (error) throw new Error(`audio upload failed: ${error.message}`);
  return key;
}

export async function promoteStaging(stagingPath: string): Promise<string> {
  const m = stagingPath.match(/^([0-9a-f-]{36})\/staging\/(.+)$/i);
  if (!m) throw new Error("not a staging path");
  const dest = `${m[1]}/${m[2]}`;
  const { error: copyErr } = await store().copy(stagingPath, dest);
  if (copyErr) throw new Error(`promote failed: ${copyErr.message}`);
  await store().remove([stagingPath]);
  return dest;
}

export async function signedUrl(path: string, ttlSec: number): Promise<string> {
  const { data, error } = await store().createSignedUrl(path, ttlSec);
  if (error || !data) throw new Error(`sign failed: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

export async function deleteCircleAudio(cid: string): Promise<void> {
  for (const prefix of [`${cid}`, `${cid}/staging`]) {
    const { data } = await store().list(prefix, { limit: 1000 });
    const keys = (data ?? []).map((o) => `${prefix}/${o.name}`);
    if (keys.length) await store().remove(keys);
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
  const { data: circles } = await store().list("", { limit: 10_000 });
  for (const dir of circles ?? []) {
    if (dir.id) continue; // files at root are unexpected; skip
    for (const prefix of [dir.name, `${dir.name}/staging`]) {
      const { data: objs } = await store().list(prefix, { limit: 10_000 });
      const stale = (objs ?? [])
        .filter((o) => o.id) // real objects only
        .filter((o) => new Date(o.created_at ?? o.updated_at ?? 0).getTime() < cutoff)
        .map((o) => `${prefix}/${o.name}`)
        .filter((key) => !referenced.has(key));
      if (stale.length) {
        await store().remove(stale);
        deleted += stale.length;
      }
    }
  }
  return { deleted };
}
