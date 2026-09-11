// STUBS — real implementation lands in Part 1c (Supabase Storage).
const NOT_WIRED = "storage not wired — Part 1c";

export async function uploadStaging(_cid: string, _buf: Buffer, _ext: string): Promise<string> {
  throw new Error(NOT_WIRED);
}
export async function promoteStaging(_stagingPath: string): Promise<string> {
  throw new Error(NOT_WIRED);
}
export async function signedUrl(_path: string, _ttlSec: number): Promise<string> {
  throw new Error(NOT_WIRED);
}
export async function deleteCircleAudio(cid: string): Promise<void> {
  console.warn(`deleteCircleAudio(${cid}): storage not wired yet — no objects removed`);
}
