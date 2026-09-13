import { adminPool } from "./db/pool.js";

// Real answer to a named residual risk in docs/pilot-privacy-assessment.md
// §6: "no audit log — if something goes wrong, there's no way to
// reconstruct who saw what, when." Writes go through adminPool
// (BYPASSRLS) — the audit_log table itself has zero policies granted to
// app_authenticated (migration 20260913000001), so this is the only path
// that can ever write to it.
export type AuditAction =
  | "checkin_audio_access"
  | "checkins_list_access"
  | "checkin_delete"
  | "circle_delete"
  | "member_remove";

export async function logAudit(
  actorId: string,
  action: AuditAction,
  opts: { circleId?: string | null; targetId?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await adminPool.query(
      `insert into public.audit_log (actor_id, action, circle_id, target_id, metadata)
       values ($1, $2, $3, $4, $5)`,
      [actorId, action, opts.circleId ?? null, opts.targetId ?? null, JSON.stringify(opts.metadata ?? {})],
    );
  } catch (err) {
    // Never let a logging failure break the actual request it's
    // describing — but never let it fail invisibly either. If this ever
    // fires in production, the audit trail has a real gap and that's
    // worth knowing about from the server logs, not silently swallowed.
    console.error(`audit log write failed (action=${action}, actor=${actorId}):`, err);
  }
}
