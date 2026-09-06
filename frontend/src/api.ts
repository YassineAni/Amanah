// Typed client for the Her Day backend. One function per endpoint.
// Every call attaches the Bearer token from session.ts.
import { API_BASE } from "./config";
import { getToken } from "./session";

export type Role = "elder" | "coordinator" | "caregiver" | "family";
export type Lang = "ar" | "fr" | "en";
export type Mood = "good" | "ok" | "hard";
export type Visibility = "circle" | "family" | "coordinator" | "mood-only";
export type Access = "full" | "mood" | "none";

export type User = {
  id: string;
  name: string;
  role: Role;
  isFamily: boolean;
  lang: Lang;
  username: string;
};

export type Shift = {
  id: string;
  caregiverId: string | null;
  caregiverName: string | null;
  start: string;
  end: string;
  purpose: string;
  activityTags: string[];
  coordinatorNote?: string;
};

export type Checkin = {
  id: string;
  date: string;
  createdVia?: "live" | "demo";
  access: Access;
  mood: Mood | null;
  noteHidden: boolean;
  transcript?: string;
  translation?: string;
  spokenLang?: Lang;
  audioUrl?: string;
  visibility?: Visibility;
};

export type CareSignalDay = {
  date: string;
  offset: number;
  isPast: boolean;
  mood: Mood | null;
  noteHidden: boolean;
  checkinId: string | null;
  shifts: { caregiverName: string | null; tags: string[] }[];
};

export type CareSignal = {
  demoDate: string;
  windowOffsets: number[];
  days: CareSignalDay[];
  callout: string | null;
};

export type PrayerTimes = {
  fajr: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

export type TaskCategory = "medication" | "personal-care" | "meal" | "rest" | "activity" | "other";

/** the expanded per-day row the plan views render */
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

export type FileCategory = "discharge" | "prescription" | "lab" | "imaging" | "care-plan" | "other";
export type FileVisibility = "circle" | "family" | "coordinator";

export type ClinicalFile = {
  id: string;
  name: string;
  category: FileCategory;
  visibility: FileVisibility;
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: string;
  mime: string;
  size: number;
  seeded?: boolean;
  scannedClean?: boolean;
  canManage: boolean;
};

export type MyShift = {
  shift: (Shift & { caregiverName: string }) | null;
  context: {
    date: string | null;
    mood: Mood | null;
    excerpt: string | null;
    noteHidden: boolean;
  } | null;
};

export type TranscribeResult = {
  transcript: string;
  translation: string;
  spokenLang: Lang;
  audioId: string;
  audioUrl: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* keep statusText */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

function json(body: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  // --- auth ---
  login: (creds: { username: string; password: string } | { userId: string }) =>
    req<{ token: string; user: User }>("/api/auth/login", { method: "POST", ...json(creds) }),
  session: () => req<{ user: User }>("/api/session"),

  // --- reads ---
  people: () => req<User[]>("/api/people"),
  shifts: () => req<Shift[]>("/api/shifts"),
  prayerTimes: () => req<PrayerTimes>("/api/prayer-times"),
  checkins: () => req<Checkin[]>("/api/checkins"),
  careSignal: () => req<CareSignal>("/api/care-signal"),
  myShift: () => req<MyShift>("/api/my-shift"),
  today: () =>
    req<{ date: string; hasCheckin: boolean; prayerTimes: PrayerTimes; pastWindow: string[] }>(
      "/api/today",
    ),

  // --- elder writes ---
  transcribe: (input: Blob | { demoUtteranceId: string }, spokenLang: Lang = "ar") => {
    const fd = new FormData();
    if (input instanceof Blob) fd.append("audio", input, "checkin.webm");
    else fd.append("demoUtteranceId", input.demoUtteranceId);
    fd.append("spokenLang", spokenLang);
    return req<TranscribeResult>("/api/transcribe", { method: "POST", body: fd });
  },
  createCheckin: (body: {
    date?: string;
    mood: Mood;
    transcript: string;
    translation?: string;
    audioId?: string;
    spokenLang?: Lang;
    visibility?: Visibility;
    createdVia?: "live" | "demo";
  }) => req<Checkin>("/api/checkins", { method: "POST", ...json(body) }),
  setVisibility: (id: string, visibility: Visibility) =>
    req<Checkin>(`/api/checkins/${id}/visibility`, { method: "PATCH", ...json({ visibility }) }),

  // --- coordinator writes ---
  updateShift: (
    id: string,
    body: { caregiverId?: string | null; activityTags?: string[]; coordinatorNote?: string },
  ) => req<Shift>(`/api/shifts/${id}`, { method: "PATCH", ...json(body) }),

  // --- care plan (weekly routine + per-day view) ---
  tasks: (date?: string) =>
    req<{ date: string; tasks: PlanRow[] }>(`/api/tasks${date ? `?date=${date}` : ""}`),
  toggleTask: (body: { date: string; key: string; done: boolean; note?: string }) =>
    req<{ date: string; tasks: PlanRow[] }>("/api/tasks/toggle", { method: "PATCH", ...json(body) }),
  addAdHoc: (body: { date: string; title: string; time: string; category: TaskCategory; timeSensitive: boolean; note?: string }) =>
    req<{ date: string; tasks: PlanRow[] }>("/api/tasks/adhoc", { method: "POST", ...json(body) }),
  deleteAdHoc: (id: string) => req<{ ok: true }>(`/api/tasks/adhoc/${id}`, { method: "DELETE" }),
  routine: () => req<RoutineItem[]>("/api/routine"),
  addRoutine: (body: { title: string; time: string; category: TaskCategory; timeSensitive: boolean; weekdays: number[] }) =>
    req<RoutineItem>("/api/routine", { method: "POST", ...json(body) }),
  updateRoutine: (id: string, body: Partial<Omit<RoutineItem, "id">>) =>
    req<RoutineItem>(`/api/routine/${id}`, { method: "PATCH", ...json(body) }),
  deleteRoutine: (id: string) => req<{ ok: true }>(`/api/routine/${id}`, { method: "DELETE" }),

  // --- clinical files ---
  files: () => req<{ files: ClinicalFile[]; canUpload: boolean }>("/api/files"),
  uploadFile: (file: File, meta: { name: string; category: FileCategory; visibility: FileVisibility }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", meta.name);
    fd.append("category", meta.category);
    fd.append("visibility", meta.visibility);
    return req<ClinicalFile>("/api/files", { method: "POST", body: fd });
  },
  updateFile: (id: string, meta: Partial<{ name: string; category: FileCategory; visibility: FileVisibility }>) =>
    req<ClinicalFile>(`/api/files/${id}`, { method: "PATCH", ...json(meta) }),
  deleteFile: (id: string) => req<{ ok: true }>(`/api/files/${id}`, { method: "DELETE" }),
  downloadFile: async (id: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(API_BASE + `/api/files/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, "download failed");
    return res.blob();
  },

  // --- demo / tts ---
  resetDemo: () => req<{ ok: true }>("/api/demo/reset", { method: "POST" }),
  demoUtterances: () => req<{ id: string; label: string }[]>("/api/demo/utterances"),
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

/** Absolute URL for an audioUrl path returned by the API (for <audio src>). */
export const audioSrc = (audioUrl: string | undefined | null) =>
  audioUrl ? API_BASE + audioUrl : undefined;
