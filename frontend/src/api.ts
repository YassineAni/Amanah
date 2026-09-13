// Typed client for the Amanah API. One function per endpoint.
// Every circle-scoped call takes a `cid` — the active circle's id (see
// circle.tsx). Every call attaches the Bearer token from session.ts.
//
// Field-naming boundary: this file is where snake_case (what the 1c API
// actually returns/expects on the wire) meets camelCase (what the rest of
// the frontend already uses). All translation happens here, once, per
// endpoint — components never see a raw API response.
import { API_BASE } from "./config";
import { getToken } from "./session";

export type CircleRole = "elder" | "coordinator" | "caregiver" | "family";
export type Lang = "ar" | "fr" | "en";
export type Mood = "good" | "ok" | "hard";
export type Visibility = "circle" | "family" | "coordinator" | "mood_only";
export type Access = "full" | "mood" | "none";
// Server enum: medication | personal_care | meal | rest | activity | other.
// Kept snake_case here (not translated to "personal-care") deliberately —
// it's used as an object key and <select> value throughout the app, not a
// prose string, so a translation layer would just be one more place for a
// silent typo to hide.
export type TaskCategory = "medication" | "personal_care" | "meal" | "rest" | "activity" | "other";

export type Profile = {
  id: string;
  email: string;
  fullName: string;
  uiLang: Lang;
  tosAcceptedAt: string | null;
  privacyNoticeVersion: string | null;
};

export type CircleSummary = { id: string; name: string; role: CircleRole; isDemo: boolean };

export type Circle = {
  id: string;
  orgId: string;
  name: string;
  elderUserId: string | null;
  elderName: string;
  elderLang: string;
  timezone: string;
};

export type Member = { id: string; name: string; role: CircleRole; isFamilyMember: boolean };

export type Shift = {
  id: string;
  caregiverId: string | null;
  caregiverName: string | null;
  start: string;
  end: string;
  purpose: string;
  activityTags: string[];
  coordinatorNote?: string;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
};

export type ShiftContext = {
  date: string | null;
  mood: Mood | null;
  excerpt: string | null;
  noteHidden: boolean;
};

export type MyShift = {
  id: string;
  circleId: string;
  circleName: string;
  start: string;
  end: string;
  purpose: string;
  coordinatorNote?: string;
  context: ShiftContext;
};

export type Checkin = {
  id: string;
  date: string;
  createdVia?: "live" | "demo";
  mood: Mood | null;
  isProxy: boolean;
  visibility: Visibility;
  recordedByName: string;
  transcript?: string;
  translation?: string;
  hasAudio: boolean;
};

export type CareSignalDay = {
  date: string;
  offset: number;
  isPast: boolean;
  mood: Mood | null;
  noteHidden: boolean;
  checkinOn: boolean;
  shifts: { caregiverName: string | null; tags: string[] }[];
};

export type CareSignal = {
  window: string[];
  days: CareSignalDay[];
};

/** the expanded per-day row the plan views render — already camelCase on
 *  the wire (domain/plan.ts's PlanRow), no translation needed. */
export type PlanRow = {
  key: string; // "r:<id>" | "a:<id>"
  kind: "routine" | "adhoc";
  title: string;
  scheduledTime: string;
  category: TaskCategory;
  timeSensitive: boolean;
  doneAt: string | null;
  doneById: string | null;
  doneByName: string | null;
  note: string | null;
  weekdays?: number[];
  addedByName?: string;
};

/** a standing item in the weekly routine */
export type RoutineItem = {
  id: string;
  title: string;
  time: string; // "HH:MM"
  category: TaskCategory;
  timeSensitive: boolean;
  weekdays: number[]; // 0=Sun..6=Sat
};

export type TranscribeResult = {
  transcript: string;
  translation: string;
  spokenLang: Lang;
  /** null for the demo-utterance path (no real audio) */
  stagingPath: string | null;
};

export type InviteInfo = { circleName: string; inviterName: string; role: CircleRole };

export class ApiError extends Error {
  status: number;
  // Machine-readable error tag from the response body (e.g.
  // "notice_required" — see server/src/auth/middleware.ts), when the
  // server sent one. Lets a caller branch on the specific failure (redirect
  // to /privacy-notice) rather than pattern-matching the human-readable
  // message or the bare HTTP status, which other routes can also return
  // for unrelated reasons.
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
      if (typeof body?.code === "string") code = body.code;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, msg, code);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

function json(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// --- response shape mappers (snake_case wire -> camelCase app) ---

function mapProfile(p: any): Profile {
  return {
    id: p.id, email: p.email, fullName: p.full_name, uiLang: p.ui_lang,
    tosAcceptedAt: p.tos_accepted_at, privacyNoticeVersion: p.privacy_notice_version,
  };
}
function mapCircleSummary(c: any): CircleSummary {
  return { id: c.id, name: c.name, role: c.role, isDemo: c.is_demo };
}
function mapMember(m: any): Member {
  return { id: m.id, name: m.name, role: m.role, isFamilyMember: m.is_family_member };
}
function mapCircle(c: any): Circle {
  return {
    id: c.id, orgId: c.org_id, name: c.name, elderUserId: c.elder_user_id,
    elderName: c.elder_name, elderLang: c.elder_lang, timezone: c.timezone,
  };
}
function mapShift(s: any): Shift {
  return {
    id: s.id, caregiverId: s.caregiver_id, caregiverName: s.caregiver_name,
    start: s.starts_at, end: s.ends_at, purpose: s.purpose, activityTags: s.activity_tags ?? [],
    coordinatorNote: s.coordinator_note ?? undefined,
    checkedInAt: s.checked_in_at, checkedOutAt: s.checked_out_at,
  };
}
function mapContext(c: any): ShiftContext {
  return { date: c.date, mood: c.mood, excerpt: c.excerpt, noteHidden: c.noteHidden };
}
function mapMyShift(s: any): MyShift {
  return {
    id: s.id, circleId: s.circle_id, circleName: s.circle_name,
    start: s.starts_at, end: s.ends_at, purpose: s.purpose,
    coordinatorNote: s.coordinator_note ?? undefined,
    context: mapContext(s.context),
  };
}
function mapCheckin(c: any): Checkin {
  return {
    id: c.id, date: c.occurred_on, createdVia: c.created_via, mood: c.mood,
    isProxy: c.is_proxy, visibility: c.visibility, recordedByName: c.recorded_by_name,
    transcript: c.transcript ?? undefined, translation: c.translation ?? undefined,
    hasAudio: !!c.has_audio,
  };
}
function mapRoutineItem(r: any): RoutineItem {
  return {
    id: r.id, title: r.title, time: r.time_of_day, category: r.category,
    timeSensitive: r.time_sensitive, weekdays: r.weekdays,
  };
}
function mapInvite(i: any): InviteInfo {
  return { circleName: i.circle_name, inviterName: i.inviter_name, role: i.role };
}

export const api = {
  // --- account / onboarding ---
  me: () => req<{ profile: any; circles: any[] }>("/api/me").then((r) => ({
    profile: mapProfile(r.profile), circles: r.circles.map(mapCircleSummary),
  })),
  acceptNotice: (version: string) =>
    req<void>("/api/me/accept-notice", { method: "POST", ...json({ version }) }),
  createCircle: (body: { elderName: string; elderLang: string; timezone: string; attestation: true; orgId?: string }) =>
    req<{ circle: any }>("/api/circles", {
      method: "POST",
      ...json({
        elder_name: body.elderName, elder_lang: body.elderLang, timezone: body.timezone,
        attestation: body.attestation, org_id: body.orgId,
      }),
    }).then((r) => mapCircle(r.circle)),
  deleteCircle: (cid: string) => req<void>(`/api/circles/${cid}`, { method: "DELETE" }),
  members: (cid: string) => req<any[]>(`/api/circles/${cid}/members`).then((rows) => rows.map(mapMember)),
  removeMember: (cid: string, userId: string) =>
    req<void>(`/api/circles/${cid}/members/${userId}`, { method: "DELETE" }),

  // --- invites ---
  createInvites: (cid: string, invites: { email: string; role: CircleRole; isFamilyMember?: boolean }[]) =>
    req<{ invites: { id: string; email: string; role: CircleRole }[] }>(`/api/circles/${cid}/invites`, {
      method: "POST",
      ...json({ invites: invites.map((i) => ({ email: i.email, role: i.role, is_family_member: i.isFamilyMember })) }),
    }),
  getInvite: (token: string) => req<any>(`/api/invites/${token}`).then(mapInvite),
  acceptInvite: (token: string) =>
    req<{ circle_id: string }>(`/api/invites/${token}/accept`, { method: "POST" }).then((r) => r.circle_id),

  // --- reads (all circle-scoped) ---
  shifts: (cid: string, range?: { from: string; to: string }) => {
    const qs = range ? `?from=${range.from}&to=${range.to}` : "";
    return req<any[]>(`/api/circles/${cid}/shifts${qs}`).then((rows) => rows.map(mapShift));
  },
  checkins: (cid: string) => req<any[]>(`/api/circles/${cid}/checkins`).then((rows) => rows.map(mapCheckin)),
  careSignal: (cid: string) => req<CareSignal>(`/api/circles/${cid}/care-signal`),
  myShifts: () => req<{ shifts: any[] }>("/api/my-shifts").then((r) => r.shifts.map(mapMyShift)),
  today: (cid: string) => req<{ today: string; has_checkin: boolean; last_mood: Mood | null }>(
    `/api/circles/${cid}/today`,
  ).then((r) => ({ date: r.today, hasCheckin: r.has_checkin, lastMood: r.last_mood })),

  // --- elder writes ---
  transcribe: (cid: string, input: Blob | { demoUtteranceId: string }, spokenLang: Lang = "ar") => {
    const fd = new FormData();
    if (input instanceof Blob) fd.append("audio", input, "checkin.webm");
    else fd.append("demoUtteranceId", input.demoUtteranceId);
    fd.append("spoken_lang", spokenLang);
    return req<any>(`/api/circles/${cid}/checkins/transcribe`, { method: "POST", body: fd }).then((r) => ({
      transcript: r.transcript, translation: r.translation, spokenLang: r.spoken_lang,
      stagingPath: r.staging_path,
    }) as TranscribeResult);
  },
  demoUtterances: (cid: string) => req<{ id: string; label: string }[]>(`/api/circles/${cid}/demo/utterances`),
  createCheckin: (cid: string, body: {
    occurredOn?: string; mood: Mood; transcript: string; translation?: string;
    stagingPath?: string | null; visibility?: Visibility;
  }) => req<{ id: string }>(`/api/circles/${cid}/checkins`, {
    method: "POST",
    ...json({
      occurred_on: body.occurredOn, mood: body.mood, transcript: body.transcript,
      translation: body.translation, staging_path: body.stagingPath, visibility: body.visibility,
    }),
  }),
  setVisibility: (cid: string, id: string, visibility: Visibility) =>
    req<{ id: string; visibility: Visibility }>(`/api/circles/${cid}/checkins/${id}`, {
      method: "PATCH", ...json({ visibility }),
    }),
  deleteCheckin: (cid: string, id: string) =>
    req<void>(`/api/circles/${cid}/checkins/${id}`, { method: "DELETE" }),
  checkinAudioUrl: (cid: string, id: string) =>
    req<{ url: string; expires_at: string }>(`/api/circles/${cid}/checkins/${id}/audio`)
      .then((r) => ({ url: r.url, expiresAt: r.expires_at })),

  // --- coordinator writes ---
  updateShift: (cid: string, id: string, body: {
    caregiverId?: string | null; activityTags?: string[]; coordinatorNote?: string;
    checkedInAt?: string | null; checkedOutAt?: string | null;
  }) => req<{ id: string }>(`/api/circles/${cid}/shifts/${id}`, {
    method: "PATCH",
    ...json({
      caregiver_id: body.caregiverId, activity_tags: body.activityTags,
      coordinator_note: body.coordinatorNote,
      checked_in_at: body.checkedInAt, checked_out_at: body.checkedOutAt,
    }),
  }),

  // --- care plan (weekly routine + per-day view) ---
  tasks: (cid: string, date?: string) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/circles/${cid}/plan${date ? `?date=${date}` : ""}`),
  toggleTask: (cid: string, body: { date: string; key: string; done: boolean; note?: string }) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/circles/${cid}/plan/toggle`, { method: "PATCH", ...json(body) }),
  addAdHoc: (cid: string, body: { date: string; title: string; time: string; category: TaskCategory; timeSensitive: boolean; note?: string }) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/circles/${cid}/adhoc`, {
      method: "POST",
      ...json({ date: body.date, title: body.title, time: body.time, category: body.category, time_sensitive: body.timeSensitive, note: body.note }),
    }),
  deleteAdHoc: (cid: string, id: string) => req<void>(`/api/circles/${cid}/adhoc/${id}`, { method: "DELETE" }),
  routine: (cid: string) => req<any[]>(`/api/circles/${cid}/routine`).then((rows) => rows.map(mapRoutineItem)),
  addRoutine: (cid: string, body: { title: string; time: string; category: TaskCategory; timeSensitive: boolean; weekdays: number[] }) =>
    req<any>(`/api/circles/${cid}/routine`, {
      method: "POST",
      ...json({ title: body.title, time: body.time, category: body.category, time_sensitive: body.timeSensitive, weekdays: body.weekdays }),
    }).then(mapRoutineItem),
  updateRoutine: (cid: string, id: string, body: Partial<Omit<RoutineItem, "id">>) =>
    req<any>(`/api/circles/${cid}/routine/${id}`, {
      method: "PATCH",
      ...json({ title: body.title, time: body.time, category: body.category, time_sensitive: body.timeSensitive, weekdays: body.weekdays }),
    }).then(mapRoutineItem),
  deleteRoutine: (cid: string, id: string) => req<void>(`/api/circles/${cid}/routine/${id}`, { method: "DELETE" }),

  // --- tts ---
  tts: async (text: string, lang: Lang): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(API_BASE + "/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text, lang }),
    });
    if (!res.ok) throw new ApiError(res.status, "tts failed");
    return res.blob();
  },
};
