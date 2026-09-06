// Per-tab auth session. sessionStorage is tab-scoped, so 4 tabs can each hold a
// different persona — exactly what the demo wants.
import type { Role, User } from "./api";

const KEY = "her-day-session";

export type Session = { token: string; user: User };

export function getSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode — session just won't persist across reloads */
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

/** Route each role opens on after sign-in. */
export function homeFor(user: Pick<User, "role" | "id">): string {
  switch (user.role) {
    case "elder":
      return "/elder";
    case "coordinator":
      return "/coordinator";
    case "caregiver":
      return user.id === "cg-lea" ? "/caregiver?who=lea" : "/caregiver";
    case "family":
      return "/family";
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  elder: "Elder",
  coordinator: "Coordinator",
  caregiver: "Caregiver",
  family: "Family",
};
