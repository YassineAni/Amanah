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

// Update the cache unconditionally (so getToken() always reflects the
// latest access_token, including a silent refresh), but only NOTIFY
// listeners when the signed-in IDENTITY actually changes (sign-in,
// sign-out, or a different user) — not on every event supabase-js fires.
// Without this distinction, circle.tsx's CircleProvider treated every
// event the same and re-fetched GET /api/me (with a full-screen loading
// state) on every one of them — including the automatic hourly
// TOKEN_REFRESHED event (autoRefreshToken: true) and a second, redundant
// firing at startup (getSession() and onAuthStateChange's own
// INITIAL_SESSION both resolve independently). For a caregiver with the
// app open through a shift, that meant a periodic full-screen "One
// moment…" flash mid-use, for no actual change in who's signed in.
function applySession(next: Session | null) {
  const changed = current?.userId !== next?.userId;
  current = next;
  resolved = true;
  if (changed) listeners.forEach((cb) => cb(current));
}

// getSession() is a Promise in supabase-js (it may need to read/refresh
// from storage) — callers like api.ts's req() need a synchronous token
// read, so this resolves once at module load and caches the result,
// staying current afterward via onAuthStateChange (fires on sign-in,
// sign-out, and token refresh alike).
//
// .catch() matters here, not just style: getSession() reads from storage
// internally, and a throw there (e.g. localStorage inaccessible in some
// private-browsing/sandboxed context, or a corrupted stored value) would
// otherwise leave `resolved` false forever — every RequireCircle-gated
// screen renders blank (`return null`) with no way out. Failing open to
// "resolved, signed out" means a real storage problem shows the sign-in
// screen, not a permanently blank one.
void supabase.auth.getSession()
  .then(({ data }) => applySession(fromSupabase(data.session)))
  .catch(() => applySession(null));

supabase.auth.onAuthStateChange((_event, s) => applySession(fromSupabase(s)));

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
