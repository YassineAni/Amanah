// Active-circle context. Role now lives on a circle_members row, not the
// auth session — this is what actually knows "who is the signed-in user,
// in this circle, and what's their role there" for every screen.
//
// Active circle = circles[0], silently — confirmed with the user (wiring
// map Q7): multi-circle membership is real but rare in the pilot, and a
// switcher UI is real added scope for an edge case. No indicator, no
// switcher.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { Redirect } from "wouter";
import { api, type CircleRole, type CircleSummary, type Profile } from "./api";
import { getSession, isSessionResolved, onSessionChange } from "./session";

export const ROLE_LABEL: Record<CircleRole, string> = {
  elder: "Elder",
  coordinator: "Coordinator",
  caregiver: "Caregiver",
  family: "Family",
};

/** Route each role opens on. Takes a role directly (not a user) — role is
 *  scoped to the active circle now, there's no longer a single fixed
 *  "user.role". Also drops the old cg-lea persona special case (?who=lea)
 *  — that was a hardcoded demo-persona id, dead along with the persona
 *  chips (Q1). */
export function homeFor(role: CircleRole): string {
  switch (role) {
    case "elder": return "/elder";
    case "coordinator": return "/coordinator";
    case "caregiver": return "/caregiver";
    case "family": return "/family";
  }
}

type CircleValue = {
  loading: boolean;
  error: string | null;
  profile: Profile | null;
  circles: CircleSummary[];
  activeCircle: CircleSummary | null;
  role: CircleRole | null;
  refresh: () => Promise<void>;
};

const CircleContext = createContext<CircleValue | null>(null);
export const useCircle = () => {
  const v = useContext(CircleContext);
  if (!v) throw new Error("useCircle outside provider");
  return v;
};

export function CircleProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [circles, setCircles] = useState<CircleSummary[]>([]);

  const refresh = useCallback(async () => {
    if (!getSession()) { setProfile(null); setCircles([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await api.me();
      setProfile(r.profile);
      setCircles(r.circles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your account");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async (hasSession: boolean) => {
      if (cancelled) return;
      if (!hasSession) { setProfile(null); setCircles([]); setLoading(false); return; }
      await refresh();
    };
    // getToken()/getSession() may already be resolved by the time this
    // mounts (session.ts starts resolving at module-import time, which
    // usually happens well before this component's effects run) — handle
    // that synchronously instead of waiting on a subscription event that
    // already fired before we could subscribe to it.
    if (isSessionResolved()) void run(!!getSession());
    // Also subscribe for whatever happens after mount: the initial
    // resolution completing (if it hadn't yet), sign-in, sign-out, token
    // refresh.
    const unsub = onSessionChange((s) => void run(!!s));
    return () => { cancelled = true; unsub(); };
  }, [refresh]);

  const activeCircle = circles[0] ?? null;

  return (
    <CircleContext.Provider
      value={{ loading, error, profile, circles, activeCircle, role: activeCircle?.role ?? null, refresh }}
    >
      {children}
    </CircleContext.Provider>
  );
}

function CenterScreen({ children }: { children: ReactNode }) {
  return <main className="ocean min-h-screen p-6 grid place-items-center"><div className="text-center">{children}</div></main>;
}

/** Gates a screen on: signed in, session check complete, in at least one
 *  circle (else -> CreateCircle — Q6), and optionally a specific role.
 *
 *  Deliberately English-only (no ar/en bilingual copy like the old
 *  RequireRole had) — that depended on session.user.lang, a field that no
 *  longer exists on the auth session (language now lives on the profile,
 *  fetched only once a session is confirmed, which is exactly what this
 *  component is still figuring out at the point it'd need to show text).
 *  A real per-role screen (e.g. Elder) that wants localized loading copy
 *  can render its own inside `loading`/`error`-aware logic instead; this
 *  is the generic, always-available fallback every route shares. */
export function RequireCircle({ role, children }: { role?: CircleRole; children: ReactNode }) {
  const { loading, error, activeCircle, refresh } = useCircle();

  if (!isSessionResolved()) return null; // avoids a sign-in-screen flash
  if (!getSession()) return <Redirect to="/" />;
  if (loading) return <CenterScreen><p className="serif text-2xl text-[#1f3740]">One moment…</p></CenterScreen>;
  if (error) {
    return (
      <CenterScreen>
        <p className="serif text-2xl text-[#1f3740]">We couldn’t load this.</p>
        <p className="mt-2 text-[#54717a]">{error}</p>
        <button onClick={() => void refresh()} className="mt-5 min-h-11 rounded-full bg-[#284c59] px-6 text-white">Try again</button>
      </CenterScreen>
    );
  }
  if (!activeCircle) return <Redirect to="/create-circle" />;
  if (role && activeCircle.role !== role) return <Redirect to={homeFor(activeCircle.role)} />;
  return <>{children}</>;
}
