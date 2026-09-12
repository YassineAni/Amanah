// Wraps Supabase auth's own session — no more per-tab persona demo hack.
// The old version used sessionStorage specifically so 4 tabs could each
// hold a different fake persona; with real magic-link auth there is one
// real signed-in identity per browser, so this now rides Supabase's own
// localStorage-backed session (shared across tabs, as a real identity
// should be) instead of managing storage itself.
//
// setSession() and the old User-shaped session are gone: Supabase's client
// manages sign-in/sign-out/refresh internally (supabase.auth.signInWithOtp,
// the magic-link redirect completing via detectSessionInUrl, onAuthStateChange)
// — there is no imperative "apply this session" call left for app code to
// make. Role/circle information is NOT part of this file anymore either:
// role now lives on a circle_members row, not the auth session, so
// homeFor()/ROLE_LABEL moved to circle.tsx, which is what actually knows
// the active circle's role.
import { supabase } from "./supabaseClient";
import type { Session as SupabaseSession } from "@supabase/supabase-js";

export type Session = { token: string; userId: string; email: string };

function fromSupabase(s: SupabaseSession | null): Session | null {
  if (!s) return null;
  return { token: s.access_token, userId: s.user.id, email: s.user.email ?? "" };
}

let current: Session | null = null;
let resolved = false;
const listeners = new Set<(s: Session | null) => void>();

// getSession() is a Promise in supabase-js (it may need to read/refresh
// from storage) — callers like api.ts's req() need a synchronous token
// read, so this resolves once at module load and caches the result,
// staying current afterward via onAuthStateChange (fires on sign-in,
// sign-out, and token refresh alike).
void supabase.auth.getSession().then(({ data }) => {
  current = fromSupabase(data.session);
  resolved = true;
  listeners.forEach((cb) => cb(current));
});

supabase.auth.onAuthStateChange((_event, s) => {
  current = fromSupabase(s);
  resolved = true;
  listeners.forEach((cb) => cb(current));
});

/** Synchronous read of the last-known session. Can be null even when a real
 *  session exists in storage, until the initial async resolution completes
 *  — see isSessionResolved()/onSessionChange() for gating render on that. */
export function getSession(): Session | null {
  return current;
}

export function getToken(): string | null {
  return current?.token ?? null;
}

/** False until the very first getSession()/onAuthStateChange resolution —
 *  the window where a real session could exist but hasn't loaded yet.
 *  Route guards should show a loading state, not redirect to sign-in,
 *  while this is false. */
export function isSessionResolved(): boolean {
  return resolved;
}

/** Subscribe to session changes. Returns an unsubscribe function. */
export function onSessionChange(cb: (s: Session | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
