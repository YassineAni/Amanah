import { afterAll, expect, test } from "vitest";
import { uploadStaging, promoteStaging, signedUrl, deleteCircleAudio, sweepOrphans } from "../../src/storage/audio.js";
import { randomUUID } from "node:crypto";

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
