import { type ReactNode, useCallback, useEffect, useRef, useState, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { Route, Switch, useLocation, Redirect } from "wouter";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, MessageSquare, Mic, Play, Quote, Volume2, X } from "lucide-react";
import { api, ApiError, type CareSignal, type Checkin, type CircleRole, type Member, type Mood, type MyShift, type PlanRow, type RoutineItem, type Shift, type TaskCategory, type Visibility } from "./api";
import { signOut as sessionSignOut } from "./session";
import { CircleProvider, RequireCircle, homeFor, useCircle } from "./circle";
import { SignIn } from "./SignIn";
import { PrivacyNotice } from "./onboarding/PrivacyNotice";
import { CreateCircle } from "./onboarding/CreateCircle";
import { AcceptInvite } from "./onboarding/AcceptInvite";
import { speak, stopSpeaking, readAloudEnabled, setReadAloud } from "./speak";
import { strings } from "./i18n";

type EnrichedShift = Shift & { caregiverIsFamily?: boolean };
type Data = {
   demoDate: string; // "today" from the active circle's own perspective (api.today's date field)
   shifts: EnrichedShift[];
   checkins: Checkin[];
   careSignal: CareSignal | null;
   members: Member[];
   myShifts: MyShift[]; // across every circle the caregiver belongs to
   tasks: PlanRow[];
   routine: RoutineItem[];
   planDate: string;
};
const EMPTY: Data = { demoDate: "", shifts: [], checkins: [], careSignal: null, members: [], myShifts: [], tasks: [], routine: [], planDate: "" };

const M: Record<string, [string, string]> = { good: ["●", "Good"], ok: ["◑", "Steady"], hard: ["▢", "Hard"] };
const MOOD_TAG: Record<string, { word: string; bg: string; fg: string }> = {
   good: { word: "Good", bg: "#e4efe7", fg: "#2f6b4f" },
   ok: { word: "Steady", bg: "#f4ecd8", fg: "#8a6416" },
   hard: { word: "Hard", bg: "#f2e2df", fg: "#a23b2e" },
};
function MoodTag({ mood, size = "md" }: { mood: "good" | "ok" | "hard" | null; size?: "sm" | "md" }) {
   if (!mood) return <span className="text-sm text-[#54717a]">Upcoming</span>;
   const t = MOOD_TAG[mood];
   return (
      <span
         className={`inline-flex items-center gap-1.5 rounded-full font-medium ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"}`}
         style={{ background: t.bg, color: t.fg }}
      >
         <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.fg }} aria-hidden />
         {t.word}
      </span>
   );
}
const date = (s: string) => new Date(s);
const fmt = (s: string) => date(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const time = (s: string) => date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// --- care-plan task categories: colour + label (medication = red) ---
const CAT: Record<TaskCategory, { label: string; fg: string; bg: string }> = {
   medication: { label: "Medication", fg: "#a23b2e", bg: "#f6e2de" },
   meal: { label: "Meal", fg: "#8a6416", bg: "#f6ecd6" },
   personal_care: { label: "Personal care", fg: "#2f6a7a", bg: "#dcecef" },
   rest: { label: "Rest", fg: "#5b4b8a", bg: "#e9e5f4" },
   activity: { label: "Activity", fg: "#3f7a4a", bg: "#e1efe4" },
   other: { label: "Task", fg: "#54717a", bg: "#e7edec" },
};
const CAT_KEYS = Object.keys(CAT) as TaskCategory[];
const WD_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const WD_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function repeatLabel(wd: number[]): string {
   const s = [...wd].sort().join(",");
   if (s === "0,1,2,3,4,5,6") return "Every day";
   if (s === "1,2,3,4,5") return "Weekdays";
   return wd.map((d) => WD_NAME[d]).join(" · ");
}
function CategoryTag({ c }: { c: TaskCategory }) {
   const x = CAT[c];
   return <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: x.fg, background: x.bg }}>{x.label}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
   useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [onClose]);
   return createPortal(
      <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[#1f3740]/25 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
         <div className="popover-in w-full max-w-md rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_24px_60px_rgba(46,84,91,.28)] backdrop-blur-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
               <h3 className="serif text-2xl text-[#1f3740]">{title}</h3>
               <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-white/60"><X size={18} /></button>
            </div>
            {children}
         </div>
      </div>,
      document.body,
   );
}

function TaskList({ tasks, canCheck, onToggle, onOpen }: { tasks: PlanRow[]; canCheck: boolean; onToggle?: (key: string, done: boolean) => void; onOpen: (row: PlanRow) => void }) {
   if (tasks.length === 0) return <p className="text-sm text-[#54717a]">Nothing planned for this day.</p>;
   return (
      <ul className="space-y-2">
         {tasks.map((t) => {
            const done = !!t.doneAt;
            return (
               <li key={t.key}>
                  <div
                     role="button"
                     tabIndex={0}
                     data-testid={`task-${t.key}`}
                     onClick={() => onOpen(t)}
                     onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(t); } }}
                     className={`flex w-full cursor-pointer items-start gap-3 rounded-2xl border p-3 text-left transition hover:bg-white/70 ${done ? "border-[#2f6b4f]/30 bg-[#e4efe7]/60" : "border-[#789a9b]/30 bg-white/45"}`}
                  >
                     <button
                        type="button"
                        aria-label={done ? "Mark not done" : "Mark done"}
                        disabled={!canCheck}
                        onClick={(e) => { e.stopPropagation(); canCheck && onToggle?.(t.key, !done); }}
                        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${done ? "border-[#2f6b4f] bg-[#2f6b4f] text-white" : "border-[#789a9b]/60"} ${canCheck ? "hover:scale-105" : "cursor-default"}`}
                     >
                        {done && <Check size={14} />}
                     </button>
                     <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                           <b className="tabular-nums text-[#1f3740]">{t.scheduledTime}</b>
                           <span className={done ? "text-[#54717a] line-through" : "text-[#1f3740]"}>{t.title}</span>
                           <CategoryTag c={t.category} />
                        </span>
                        {done ? (
                           <span className="mt-0.5 block text-xs text-[#2f6b4f]">
                              Done{t.timeSensitive && t.doneAt ? ` at ${hhmm(t.doneAt)}` : ""}{t.doneByName ? ` · ${t.doneByName}` : ""}
                           </span>
                        ) : t.timeSensitive ? (
                           <span className="mt-0.5 block text-xs text-[#54717a]">Time matters — logged when done</span>
                        ) : null}
                        {t.note && <span className="mt-0.5 block truncate text-xs italic text-[#54717a]">“{t.note}”</span>}
                     </span>
                  </div>
               </li>
            );
         })}
      </ul>
   );
}

function TaskCard({ row, canCheck, onToggle, onDeleteAdHoc, onClose }: {
   row: PlanRow; canCheck: boolean;
   onToggle: (key: string, done: boolean, note?: string) => void;
   onDeleteAdHoc?: (key: string) => void;
   onClose: () => void;
}) {
   const done = !!row.doneAt;
   const [note, setNote] = useState(row.note ?? "");
   return (
      <Modal title={row.title} onClose={onClose}>
         <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
               <b className="tabular-nums text-lg text-[#1f3740]">{row.scheduledTime}</b>
               <CategoryTag c={row.category} />
               {row.timeSensitive && <span className="rounded-full bg-[#f2e2df] px-2 py-0.5 text-[11px] font-semibold text-[#a23b2e]">Time matters</span>}
            </div>
            <p className="text-[#54717a]">
               {row.kind === "routine"
                  ? `Part of the weekly routine · ${repeatLabel(row.weekdays ?? [])}`
                  : `One-off${row.addedByName ? ` · added by ${row.addedByName}` : ""}`}
            </p>
            <p className={done ? "text-[#2f6b4f]" : "text-[#54717a]"}>
               {done ? `Done at ${hhmm(row.doneAt!)}${row.doneByName ? ` · ${row.doneByName}` : ""}` : "Not done yet."}
            </p>

            {canCheck && (
               <>
                  <label className="block">
                     <span className="mb-1 block text-xs font-medium text-[#54717a]">Note (optional)</span>
                     <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="How did it go?" className="w-full rounded-xl border border-[#789a9b]/50 bg-white/70 px-3 py-2 text-sm outline-none focus:border-[#284c59]" />
                  </label>
                  <div className="flex flex-wrap gap-2 pt-1">
                     {done ? (
                        <>
                           <button onClick={() => { onToggle(row.key, true, note.trim() || undefined); onClose(); }} className="min-h-10 rounded-full bg-[#294e59] px-4 text-sm text-white hover:bg-[#1f3a44]">Update note</button>
                           <button onClick={() => { onToggle(row.key, false); onClose(); }} className="min-h-10 rounded-full border border-[#789a9b]/50 bg-white/60 px-4 text-sm hover:bg-white/80">Mark not done</button>
                        </>
                     ) : (
                        <button onClick={() => { onToggle(row.key, true, note.trim() || undefined); onClose(); }} className="min-h-10 rounded-full bg-[#294e59] px-4 text-sm text-white hover:bg-[#1f3a44]">Mark done</button>
                     )}
                     {row.kind === "adhoc" && onDeleteAdHoc && (
                        <button onClick={() => { onDeleteAdHoc(row.key); onClose(); }} className="min-h-10 rounded-full border border-[#789a9b]/50 bg-white/60 px-4 text-sm text-[#8a2f24] hover:bg-white/80">Remove</button>
                     )}
                  </div>
               </>
            )}
            {!canCheck && row.note && <p className="rounded-xl bg-white/60 p-3 italic text-[#42616a]">“{row.note}”</p>}
         </div>
      </Modal>
   );
}

function RoutineCard({ item, onSave, onDelete, onClose }: {
   item: RoutineItem;
   onSave: (patch: Partial<Omit<RoutineItem, "id">>) => void;
   onDelete: () => void;
   onClose: () => void;
}) {
   const [title, setTitle] = useState(item.title);
   const [t, setT] = useState(item.time);
   const [cat, setCat] = useState<TaskCategory>(item.category);
   const [ts, setTs] = useState(item.timeSensitive);
   const [wd, setWd] = useState<number[]>(item.weekdays);
   const toggleWd = (d: number) => setWd((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));
   return (
      <Modal title="Routine item" onClose={onClose}>
         <div className="space-y-3 text-sm">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/70 px-3 outline-none focus:border-[#284c59]" />
            <div className="flex gap-2">
               <input type="time" value={t} onChange={(e) => setT(e.target.value)} className="min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/70 px-2 outline-none" />
               <select value={cat} onChange={(e) => setCat(e.target.value as TaskCategory)} className="min-h-10 flex-1 rounded-xl border border-[#789a9b]/50 bg-white/70 px-2 outline-none">
                  {CAT_KEYS.map((k) => <option key={k} value={k}>{CAT[k].label}</option>)}
               </select>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ts} onChange={(e) => setTs(e.target.checked)} /> The time it happens matters</label>
            <div>
               <span className="mb-1 block text-xs font-medium text-[#54717a]">Runs on</span>
               <div className="flex gap-1">
                  {WD_SHORT.map((d, i) => (
                     <button key={i} type="button" onClick={() => toggleWd(i)} className={`h-9 w-9 rounded-lg text-sm ${wd.includes(i) ? "bg-[#284c59] text-white" : "border border-[#789a9b]/50 bg-white/60"}`}>{d}</button>
                  ))}
               </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
               <button onClick={() => { onSave({ title: title.trim() || item.title, time: t, category: cat, timeSensitive: ts, weekdays: wd.length ? wd : item.weekdays }); onClose(); }} className="min-h-10 rounded-full bg-[#294e59] px-4 text-sm text-white hover:bg-[#1f3a44]">Save</button>
               <button onClick={() => { onDelete(); onClose(); }} className="min-h-10 rounded-full border border-[#789a9b]/50 bg-white/60 px-4 text-sm text-[#8a2f24] hover:bg-white/80">Delete</button>
            </div>
         </div>
      </Modal>
   );
}

function RoutinePlanner({ routine, selectedWd, setSelectedWd, onAdd, onOpen }: {
   routine: RoutineItem[]; selectedWd: number; setSelectedWd: (d: number) => void;
   onAdd: (b: { title: string; time: string; category: TaskCategory; timeSensitive: boolean; weekdays: number[] }) => void;
   onOpen: (item: RoutineItem) => void;
}) {
   const [title, setTitle] = useState("");
   const [t, setT] = useState("09:00");
   const [cat, setCat] = useState<TaskCategory>("other");
   const [repeat, setRepeat] = useState<"day" | "everyday" | "weekdays">("day");
   const items = routine.filter((r) => r.weekdays.includes(selectedWd)).sort((a, b) => (a.time < b.time ? -1 : 1));
   const wdFor = () => (repeat === "everyday" ? [0, 1, 2, 3, 4, 5, 6] : repeat === "weekdays" ? [1, 2, 3, 4, 5] : [selectedWd]);
   const ts = cat === "medication" || cat === "rest" || cat === "personal_care";
   return (
      <div className="mt-4">
         <div className="flex gap-1">
            {WD_SHORT.map((d, i) => (
               <button key={i} type="button" onClick={() => setSelectedWd(i)} className={`h-10 flex-1 rounded-lg text-sm font-medium ${selectedWd === i ? "bg-[#284c59] text-white" : "border border-[#789a9b]/40 bg-white/50 hover:bg-white/70"}`}>{d}</button>
            ))}
         </div>
         <p className="mt-2 text-xs text-[#54717a]">Tasks that run on {WD_NAME[selectedWd]}. Tap one to edit.</p>
         <ul className="mt-3 space-y-2">
            {items.length === 0 && <li className="text-sm text-[#54717a]">Nothing set for this day.</li>}
            {items.map((r) => (
               <li key={r.id}>
                  <button type="button" data-testid={`routine-${r.id}`} onClick={() => onOpen(r)} className="flex w-full items-center gap-2 rounded-2xl border border-[#789a9b]/30 bg-white/45 p-3 text-left hover:bg-white/70">
                     <b className="tabular-nums text-[#1f3740]">{r.time}</b>
                     <span className="flex-1 text-[#1f3740]">{r.title}</span>
                     <CategoryTag c={r.category} />
                     <span className="text-xs text-[#54717a]">{repeatLabel(r.weekdays)}</span>
                  </button>
               </li>
            ))}
         </ul>
         <div className="mt-4 flex flex-wrap items-end gap-2">
            <input type="time" value={t} onChange={(e) => setT(e.target.value)} className="min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/60 px-2 text-sm outline-none" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Add a task for ${WD_NAME[selectedWd]}`} className="min-h-10 flex-1 min-w-[10rem] rounded-xl border border-[#789a9b]/50 bg-white/60 px-3 text-sm outline-none focus:border-[#284c59]" />
            <select value={cat} onChange={(e) => setCat(e.target.value as TaskCategory)} className="min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/60 px-2 text-sm outline-none">
               {CAT_KEYS.map((k) => <option key={k} value={k}>{CAT[k].label}</option>)}
            </select>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)} className="min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/60 px-2 text-sm outline-none">
               <option value="day">This day</option>
               <option value="everyday">Every day</option>
               <option value="weekdays">Weekdays</option>
            </select>
            <button onClick={() => { if (title.trim()) { onAdd({ title: title.trim(), time: t, category: cat, timeSensitive: ts, weekdays: wdFor() }); setTitle(""); } }} className="min-h-10 rounded-full bg-[#294e59] px-4 text-sm text-white hover:bg-[#1f3a44]">Add</button>
         </div>
      </div>
   );
}

// ---------------------------------------------------------------------------

type AppValue = {
   data: Data;
   loading: boolean;
   error: string | null;
   refresh: () => Promise<void>;
   refreshTasks: () => Promise<void>;
   createCheckin: (body: Omit<Parameters<typeof api.createCheckin>[1], "occurredOn">) => Promise<void>;
   updateVisibility: (id: string, vis: Visibility) => Promise<void>;
   updateShift: (id: string, body: Parameters<typeof api.updateShift>[2]) => Promise<void>;
   toggleTask: (key: string, done: boolean, note?: string) => Promise<void>;
   addAdHoc: (body: Omit<Parameters<typeof api.addAdHoc>[1], "date">) => Promise<void>;
   deleteAdHoc: (key: string) => Promise<void>;
   addRoutine: (body: Parameters<typeof api.addRoutine>[1]) => Promise<void>;
   updateRoutine: (id: string, body: Parameters<typeof api.updateRoutine>[2]) => Promise<void>;
   deleteRoutine: (id: string) => Promise<void>;
};
const AppContext = createContext<AppValue | null>(null);
export const useApp = () => {
   const v = useContext(AppContext);
   if (!v) throw new Error("useApp outside provider");
   return v;
};

// Mounted INSIDE RequireCircle for each role route (see App() at the bottom
// of this file) — by the time this renders, RequireCircle has already
// guaranteed a signed-in user with an accepted notice and an active circle,
// so this is purely "given that circle + role, fetch the role-specific
// data," not auth/session/circle-membership plumbing (circle.tsx's job now).
function AppProvider({ children }: { children: ReactNode }) {
   const { activeCircle, role } = useCircle();
   const cid = activeCircle!.id; // RequireCircle guarantees this is non-null here
   const [data, setData] = useState<Data>(EMPTY);
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);

   const refresh = useCallback(async () => {
      setLoading(true);
      setError(null);
      try {
         const today = await api.today(cid);
         const demoDate = today.date ?? "";
         const base: Partial<Data> = { demoDate };
         if (role === "elder") {
            const [shifts, checkins] = await Promise.all([api.shifts(cid), api.checkins(cid)]);
            setData({ ...EMPTY, ...base, shifts, checkins });
         } else if (role === "coordinator") {
            const [careSignal, shifts, members, plan, routine] =
               await Promise.all([api.careSignal(cid), api.shifts(cid), api.members(cid), api.tasks(cid, demoDate), api.routine(cid)]);
            const enriched = shifts.map((sh) => ({ ...sh, caregiverIsFamily: members.find((m) => m.id === sh.caregiverId)?.isFamilyMember ?? false }));
            setData({ ...EMPTY, ...base, careSignal, shifts: enriched, members, tasks: plan.tasks, routine, planDate: plan.date });
         } else if (role === "caregiver") {
            const all = await api.myShifts();
            // Scoped to the active circle, not every circle this caregiver
            // is in — the rest of this screen (tasks/plan) is already
            // active-circle-scoped (Q7: circles[0], no switcher), so a
            // shift from a DIFFERENT family's circle showing here would be
            // inconsistent with the plan panel right below it, and would
            // reveal cross-family membership on a screen not designed to
            // disambiguate that.
            const myShifts = all.filter((s) => s.circleId === cid);
            const planDay = myShifts[0] ? myShifts[0].start.slice(0, 10) : demoDate;
            const plan = await api.tasks(cid, planDay);
            setData({ ...EMPTY, ...base, myShifts, tasks: plan.tasks, planDate: plan.date });
         } else {
            const [checkins, plan] = await Promise.all([api.checkins(cid), api.tasks(cid, demoDate)]);
            setData({ ...EMPTY, ...base, checkins, tasks: plan.tasks, planDate: plan.date });
         }
      } catch (e) {
         if (e instanceof ApiError && e.status === 401) void sessionSignOut();
         setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
         setLoading(false);
      }
   }, [cid, role]);

   useEffect(() => { void refresh(); }, [refresh]);

   // switching back to a tab picks up changes made elsewhere
   useEffect(() => {
      const onFocus = () => void refresh();
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
   }, [refresh]);

   const dataRef = useRef(data);
   dataRef.current = data;
   const refreshTasks: AppValue["refreshTasks"] = useCallback(async () => {
      const d = dataRef.current;
      try {
         const [plan, routine] = await Promise.all([
            api.tasks(cid, d.planDate || d.demoDate || undefined),
            role === "coordinator" ? api.routine(cid) : Promise.resolve(d.routine),
         ]);
         setData((cur) => ({ ...cur, tasks: plan.tasks, planDate: plan.date, routine }));
      } catch { /* keep what we have */ }
   }, [cid, role]);

   const createCheckin: AppValue["createCheckin"] = async (body) => { await api.createCheckin(cid, body); await refresh(); };
   const updateVisibility: AppValue["updateVisibility"] = async (id, vis) => { await api.setVisibility(cid, id, vis); await refresh(); };
   const updateShift: AppValue["updateShift"] = async (id, body) => { await api.updateShift(cid, id, body); await refresh(); };
   const toggleTask: AppValue["toggleTask"] = async (key, done, note) => {
      setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.key === key ? { ...t, doneAt: done ? (t.doneAt ?? new Date().toISOString()) : null, note: note ?? t.note } : t)) }));
      try { await api.toggleTask(cid, { date: dataRef.current.planDate || dataRef.current.demoDate, key, done, note }); } finally { await refreshTasks(); }
   };
   const addAdHoc: AppValue["addAdHoc"] = async (body) => { await api.addAdHoc(cid, { ...body, date: dataRef.current.planDate || dataRef.current.demoDate }); await refreshTasks(); };
   const deleteAdHoc: AppValue["deleteAdHoc"] = async (key) => {
      setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.key !== key) }));
      try { await api.deleteAdHoc(cid, key.replace(/^a:/, "")); } finally { await refreshTasks(); }
   };
   const addRoutine: AppValue["addRoutine"] = async (body) => { await api.addRoutine(cid, body); await refreshTasks(); };
   const updateRoutine: AppValue["updateRoutine"] = async (id, body) => { await api.updateRoutine(cid, id, body); await refreshTasks(); };
   const deleteRoutine: AppValue["deleteRoutine"] = async (id) => { await api.deleteRoutine(cid, id); await refreshTasks(); };

   return (
      <AppContext.Provider value={{ data, loading, error, refresh, refreshTasks, createCheckin, updateVisibility, updateShift, toggleTask, addAdHoc, deleteAdHoc, addRoutine, updateRoutine, deleteRoutine }}>
         {children}
      </AppContext.Provider>
   );
}

// ---------------------------------------------------------------------------

function Screen({ children }: { children: ReactNode }) {
   return <main className="ocean min-h-screen p-6 grid place-items-center"><div className="text-center">{children}</div></main>;
}

// RequireRole is gone — circle.tsx's RequireCircle now owns session/notice/
// circle/role gating (it has the info to do that; this component never
// did). What's left here is narrower: AppProvider's OWN role-specific data
// fetch (shifts/checkins/tasks/etc) hasn't necessarily resolved yet even
// once RequireCircle has cleared a screen to render — this holds the
// screen until that first load completes, same as the old RequireRole's
// second half did. English-only, same reasoning as RequireCircle: the
// bilingual copy here depended on session.user.lang, which doesn't exist
// at this layer anymore (Elder's own screen still has real ar/en support
// for its own content, via i18n.ts — this is just the generic data-loading
// gate every role route shares).
function RequireData({ children }: { children: ReactNode }) {
   const { data, error, refresh } = useApp();
   const firstLoad = !data.demoDate; // no data yet this session
   if (firstLoad && error) return <Screen><p className="serif text-2xl text-[#1f3740]">We couldn’t load this.</p><p className="mt-2 text-[#54717a]">{error}</p><button onClick={() => void refresh()} className="mt-5 min-h-11 rounded-full bg-[#284c59] px-6 text-white">Try again</button></Screen>;
   // hold the screen until the first data arrives — components assume it's there
   if (firstLoad) return <Screen><p className="serif text-2xl text-[#1f3740]">One moment…</p></Screen>;
   return <>{children}</>;
}

// ---------------------------------------------------------------------------

function Speaker({ text, lang = "en", label = "Hear this" }: { text: string; lang?: "ar" | "fr" | "en"; label?: string }) {
   return (
      <button
         type="button"
         onClick={() => void speak(text, lang)}
         aria-label={label}
         className="inline-flex items-center gap-2 min-h-10 rounded-full border border-[#789a9b]/50 bg-white/40 px-3 text-sm hover:bg-white/60 transition"
      >
         <Volume2 size={17} /> {label}
      </button>
   );
}

function Footer() {
   return <p className="py-6 text-center text-xs tracking-wide text-[#668087]">Demo · fictional data</p>;
}

function Brand({ label, signOutLabel = "Sign out" }: { label: string; signOutLabel?: string }) {
   const [, setLocation] = useLocation();
   // Awaits sign-out before navigating (not fire-and-forget) — otherwise
   // SignIn briefly renders while session.ts's cached session hasn't
   // cleared yet (onAuthStateChange's SIGNED_OUT event fires a moment
   // later), redirecting back to the role screen before bouncing to "/"
   // again a beat after that. Self-correcting either way, but visibly
   // flickery; this ordering avoids the flicker entirely.
   const out = () => { stopSpeaking(); void sessionSignOut().then(() => setLocation("/")); };
   return (
      <header className="flex items-center justify-between border-b border-[#789a9b]/30 pb-5">
         <button onClick={out} className="flex items-center gap-3 text-start rounded-full focus-visible:outline focus-visible:outline-4 focus-visible:outline-[#547e80]">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-white/80 bg-white/45 font-semibold">A</span>
            <b className="text-[#1f3740]">Amanah</b>
         </button>
         <div className="flex items-center gap-4">
            <span className="text-sm text-[#58767d] hidden sm:inline">{label}</span>
            <button onClick={out} className="min-h-10 rounded-full border border-white/60 bg-white/30 px-4 text-sm hover:bg-white/50 transition">{signOutLabel}</button>
         </div>
      </header>
   );
}

// ---------------------------------------------------------------------------

const UILANG_KEY = "her-day-uilang";

function Elder() {
   const { data, createCheckin, updateVisibility } = useApp();
   const { profile, activeCircle } = useCircle();
   const cid = activeCircle!.id;
   const name = profile?.fullName ?? "";

   // Her interface defaults to her own language; this toggle lets her (or a
   // helper) switch, and the choice sticks. The button itself is pinned to a
   // fixed spot and never moves.
   const [uiLang, setUiLang] = useState<"ar" | "en">(() => {
      try {
         const saved = sessionStorage.getItem(UILANG_KEY);
         if (saved === "ar" || saved === "en") return saved;
      } catch { /* ignore */ }
      return profile?.uiLang === "ar" ? "ar" : "en";
   });
   const toggleLang = () => {
      const next = uiLang === "ar" ? "en" : "ar";
      setUiLang(next);
      try { sessionStorage.setItem(UILANG_KEY, next); } catch { /* ignore */ }
   };
   const lang = uiLang;
   const t = strings(lang);

   const [sheet, setSheet] = useState<"record" | "share" | "a11y" | null>(null);
   const [textSize, setTextSize] = useState<0 | 1 | 2>(() => {
      try { const v = Number(sessionStorage.getItem("her-day-textsize")); return v === 1 || v === 2 ? v : 0; } catch { return 0; }
   });
   const [contrast, setContrast] = useState(() => { try { return sessionStorage.getItem("her-day-hc") === "1"; } catch { return false; } });
   const [loupe, setLoupe] = useState(false);
   const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
   const [readAloud, setRA] = useState(readAloudEnabled());
   const [recording, setRecording] = useState(false);
   const [transcribing, setTranscribing] = useState(false);
   const [recErr, setRecErr] = useState<string | null>(null);
   // audioUrl (when present) is a client-side object URL of the just-recorded
   // Blob, not a server URL — there is no signed URL to play back yet at
   // review time (staging_path is only promoted to a real object, with a
   // signed URL, once the checkin is actually saved). Revoked on save/close
   // to avoid leaking it.
   const [review, setReview] = useState<{ transcript: string; translation: string; stagingPath: string | null; audioUrl?: string; via: "live" | "demo" } | null>(null);
   // save()/closeRecord() both revoke review.audioUrl explicitly, but
   // neither fires if the sheet is abandoned some other way — direct URL
   // navigation, browser back, or sign-out while it's open. This mirror ref
   // + unmount-only cleanup catches those paths too; revoking an
   // already-revoked URL is a harmless no-op, so this can't double-free.
   const reviewAudioUrl = useRef<string | undefined>(undefined);
   reviewAudioUrl.current = review?.audioUrl;
   useEffect(() => () => { if (reviewAudioUrl.current) URL.revokeObjectURL(reviewAudioUrl.current); }, []);
   const [arabicFirst, setArabicFirst] = useState(lang === "ar");
   const [mood, setMood] = useState<string>("good");
   const [share, setShare] = useState<string>("circle");

   const recorder = useRef<MediaRecorder | null>(null);
   // Set by closeRecord() before runTranscribe() would otherwise fire (or
   // while it's in flight) — this codebase has no AbortController wired
   // through fetch anywhere, so a request already in flight when the user
   // cancels still completes (the audio was already sent to OpenAI by
   // then); this at minimum stops a cancelled recording from resurrecting
   // a review UI afterward, and stops onstop from ever starting a new
   // request at all in the common "stop then immediately close" case.
   const cancelled = useRef(false);
   const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";

   // her interface reads right-to-left when her language is Arabic
   useEffect(() => {
      document.documentElement.lang = lang;
      document.documentElement.dir = t.dir;
      return () => { document.documentElement.dir = "ltr"; document.documentElement.lang = "en"; };
   }, [lang, t.dir]);

   // "Larger" = a real zoom: scale the root so every rem-sized thing grows
   useEffect(() => {
      const pct = textSize === 2 ? "185%" : textSize === 1 ? "140%" : "100%";
      document.documentElement.style.fontSize = pct;
      try { sessionStorage.setItem("her-day-textsize", String(textSize)); } catch { /* ignore */ }
      return () => { document.documentElement.style.fontSize = ""; };
   }, [textSize]);
   useEffect(() => { try { sessionStorage.setItem("her-day-hc", contrast ? "1" : "0"); } catch { /* ignore */ } }, [contrast]);

   // magnifier lens follows the pointer
   useEffect(() => {
      if (!loupe) { setMouse(null); return; }
      const move = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
      const gone = () => setMouse(null);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseout", (e) => { if (!e.relatedTarget) gone(); });
      return () => { window.removeEventListener("mousemove", move); };
   }, [loupe]);

   const base = data.demoDate ? date(data.demoDate) : new Date();
   const visits = data.shifts
      .filter((s) => { const d = date(s.start); return d >= base && d < new Date(base.getTime() + 2 * 86400000); })
      .sort((a, b) => date(a.start).getTime() - date(b.start).getTime());
   const moodLabel: Record<string, string> = { good: t.moodGood, ok: t.moodOk, hard: t.moodHard };
   const dayWord = (s: Shift) => (date(s.start) < new Date(base.getTime() + 86400000) ? t.today : t.tomorrow);

   const introSpeech = `${t.greeting(name)} ${t.yoursToTell}`;
   const daySpeech = visits.length
      ? visits.map((s) => `${dayWord(s)} ${time(s.start)} · ${s.caregiverName ?? t.notAssigned} · ${s.purpose}`).join(". ")
      : t.noVisit;

   useEffect(() => { if (readAloud) void speak(introSpeech, lang); return () => stopSpeaking(); }, [readAloud, introSpeech, lang]);

   const runTranscribe = async (input: Blob | { demoUtteranceId: string }, via: "live" | "demo") => {
      setTranscribing(true);
      setRecErr(null);
      try {
         const r = await api.transcribe(cid, input, "ar");
         if (cancelled.current) return; // she closed the sheet while this was in flight
         const audioUrl = input instanceof Blob ? URL.createObjectURL(input) : undefined;
         setReview({ transcript: r.transcript, translation: r.translation, stagingPath: r.stagingPath, audioUrl, via });
      } catch (e) {
         if (!cancelled.current) setRecErr(e instanceof Error ? (via === "demo" ? t.exampleError : t.transcribeError) : t.transcribeError);
      } finally {
         if (!cancelled.current) setTranscribing(false);
      }
   };

   const start = async () => {
      cancelled.current = false;
      setRecErr(null);
      if (isDemo) {
         try {
            const list = await api.demoUtterances(cid);
            await runTranscribe({ demoUtteranceId: list[0]?.id ?? "u1" }, "demo");
         } catch { setRecErr(t.exampleError); }
         return;
      }
      try {
         const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
         const r = new MediaRecorder(stream);
         const parts: BlobPart[] = [];
         r.ondataavailable = (e) => parts.push(e.data);
         r.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            setRecording(false);
            // Closing the sheet calls recorder.stop() (triggers this
            // handler asynchronously) and sets cancelled.current = true
            // synchronously beforehand — checking here stops the "stop
            // then immediately close" race from ever starting a new
            // transcribe request at all, not just from displaying its result.
            if (!cancelled.current) void runTranscribe(new Blob(parts, { type: r.mimeType }), "live");
         };
         r.start();
         recorder.current = r;
         setRecording(true);
      } catch {
         setRecErr(t.micError);
      }
   };

   // the finish button just stops recording — onstop transcribes automatically
   const finish = () => { if (recording) recorder.current?.stop(); };

   const save = async () => {
      if (!review) return;
      await createCheckin({ mood: mood as Mood, transcript: review.transcript, translation: review.translation, stagingPath: review.stagingPath, visibility: share as Visibility });
      if (review.audioUrl) URL.revokeObjectURL(review.audioUrl);
      setReview(null); setSheet(null); setRecErr(null);
   };

   const closeRecord = () => {
      cancelled.current = true;
      recorder.current?.stop();
      stopSpeaking();
      if (review?.audioUrl) URL.revokeObjectURL(review.audioUrl);
      setSheet(null); setReview(null); setRecErr(null); setTranscribing(false); setRecording(false);
   };

   const toggleRA = () => { const n = !readAloud; setRA(n); setReadAloud(n); if (!n) stopSpeaking(); };

   const pageInner = (
      <>
         <Brand label={t.evening} signOutLabel={t.signOut} />
         <div className="mt-3 self-end flex gap-2">
            <button
               data-testid="button-language"
               onClick={toggleLang}
               aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
               className="min-h-11 rounded-full border border-white/60 bg-white/30 px-4 font-semibold tracking-wide"
            >
               {lang === "ar" ? "EN" : "AR"}
            </button>
            <button data-testid="button-accessibility" onClick={() => setSheet("a11y")} aria-label={t.a11yTitle} className="min-h-11 min-w-11 rounded-full border border-white/60 bg-white/30 px-4 text-lg font-semibold">A</button>
         </div>
         <div className="grid flex-1 items-center gap-10 py-10 md:grid-cols-[1fr_.8fr]">
               <section>
                  <p className="uppercase tracking-[.14em] text-[#54717a]">{t.evening}</p>
                  <h1 className="serif mt-3 text-5xl md:text-7xl">{t.greeting(name)}</h1>
                  <p className="mt-5 text-xl text-[#42616a]">{t.yoursToTell}</p>
                  <div className="mt-5"><Speaker text={introSpeech} lang={lang} label={t.readThis} /></div>
               </section>
               <section className="glass rounded-[32px] p-5">
                  {[0, 1].map((offset) => {
                     const title = offset ? t.tomorrow : t.today;
                     const ds = new Date(base.getTime() + offset * 86400000);
                     const items = visits.filter((s) => date(s.start) >= ds && date(s.start) < new Date(ds.getTime() + 86400000));
                     return (
                        <div className="mb-5" key={offset}>
                           <p className="text-sm text-[#54717a]">{title}</p>
                           {items.length ? items.map((s) => (
                              <div key={s.id} className="mt-3 rounded-3xl border border-white/70 bg-white/40 p-4">
                                 <b>{time(s.start)} · {s.caregiverName ?? t.notAssigned}</b>
                                 <p>{s.purpose}</p>
                              </div>
                           )) : <p className="mt-2 text-[#58767d]">{t.noVisit}</p>}
                        </div>
                     );
                  })}
                  <div className="mt-3">
                     <Speaker text={daySpeech} lang={lang} label={t.readMyDay} />
                  </div>
               </section>
            </div>
            <div className="max-w-xl">
               <button data-testid="button-tell-day" onClick={() => { setSheet("record"); void start(); }} className="flex min-h-16 w-full items-center justify-center gap-3 rounded-[22px] bg-[#284c59] text-xl text-[#f7f5ed] transition hover:bg-[#1f3a44]">
                  <Mic /> {t.tellAboutToday}
               </button>
               <button data-testid="button-shared-controls" onClick={() => setSheet("share")} className="mt-3 min-h-11 underline">
                  {t.whatIShared} <ChevronRight className="inline rtl:rotate-180" size={17} />
               </button>
            </div>
            <Footer />
         </>
   );

   return (
      <main className={`ocean min-h-[100dvh] p-5 ${contrast ? "contrast-[1.35]" : ""} ${loupe && mouse ? "loupe-on" : ""}`}>
         <div className="mx-auto flex min-h-[calc(100dvh-40px)] max-w-[1180px] flex-col">
            {pageInner}
         </div>

         {loupe && mouse && !sheet && <Loupe x={mouse.x} y={mouse.y}>{pageInner}</Loupe>}

         {sheet === "a11y" && (
            <div className="fixed inset-0 z-10 bg-[#d5e8e5]/95 p-6 backdrop-blur-xl overflow-y-auto">
               <button data-testid="button-close-a11y" onClick={() => setSheet(null)} className="ms-auto block min-h-11"><X /></button>
               <div className="mx-auto max-w-md space-y-6 pb-10">
                  <h2 className="serif text-4xl">{t.a11yTitle}</h2>
                  <div>
                     <p className="mb-2 font-semibold text-[#1f3740]">{t.textSize}</p>
                     <div className="flex gap-2">
                        {([0, 1, 2] as const).map((n) => (
                           <button key={n} data-testid={`text-size-${n}`} aria-pressed={textSize === n} onClick={() => setTextSize(n)}
                              className={`flex-1 min-h-12 rounded-full border ${textSize === n ? "bg-[#284c59] text-white border-[#284c59]" : "border-[#789a9b]/50 bg-white/40"}`}>
                              <span style={{ fontSize: n === 2 ? "1.35em" : n === 1 ? "1.15em" : "1em" }}>{n === 0 ? t.sizeNormal : n === 1 ? t.sizeLarge : t.sizeLarger}</span>
                           </button>
                        ))}
                     </div>
                  </div>
                  <button data-testid="toggle-contrast" aria-pressed={contrast} onClick={() => setContrast((v) => !v)}
                     className={`w-full min-h-12 rounded-full border px-5 ${contrast ? "bg-[#284c59] text-white border-[#284c59]" : "border-[#789a9b]/50 bg-white/40"}`}>{t.higherContrast}</button>
                  <div>
                     <button data-testid="toggle-magnifier" aria-pressed={loupe} onClick={() => setLoupe((v) => !v)}
                        className={`w-full min-h-12 rounded-full border px-5 ${loupe ? "bg-[#284c59] text-white border-[#284c59]" : "border-[#789a9b]/50 bg-white/40"}`}>{t.magnifier}</button>
                     <p className="mt-1 text-xs text-[#54717a]">{t.magnifierHint}</p>
                  </div>
                  <button data-testid="toggle-readaloud" aria-pressed={readAloud} onClick={toggleRA}
                     className={`w-full min-h-12 rounded-full border px-5 ${readAloud ? "bg-[#284c59] text-white border-[#284c59]" : "border-[#789a9b]/50 bg-white/40"}`}>{t.readAloud}</button>
               </div>
            </div>
         )}

         {sheet === "record" && (
            <div className="fixed inset-0 z-10 flex flex-col bg-[#d5e8e5]/95 p-6 backdrop-blur-xl overflow-y-auto">
               <button data-testid="button-close-recording" onClick={closeRecord} className="ms-auto min-h-11">
                  <X />
               </button>
               <div className="m-auto max-w-xl text-center w-full pb-10">
                  <p className="uppercase tracking-[.15em]">{review ? t.readyToReview : t.listening}</p>
                  <h2 className="serif mt-3 text-5xl">{review ? t.doesThisFeelRight : t.takeYourTime(name)}</h2>
                  {!review && <div className="mt-4"><Speaker text={`${t.takeYourTime(name)} ${t.tellAboutToday}`} lang={lang} label={t.readThis} /></div>}
                  {recErr && <p role="alert" className="mt-4 rounded-2xl border border-[#a23b2e]/50 bg-white/50 p-3 text-[#a23b2e]">{recErr}</p>}
                  {review ? (
                     <>
                        <div className="glass mt-7 rounded-3xl p-5 text-start">
                           <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <button type="button" onClick={() => setArabicFirst((v) => !v)} className="min-h-10 rounded-full border border-[#789a9b]/50 bg-white/40 px-3 text-sm hover:bg-white/60 transition">
                                 {arabicFirst ? t.showEnglishFirst : t.emphasiseArabic}
                              </button>
                              <Speaker text={`${review.translation}. ${review.transcript}`} lang={arabicFirst ? "ar" : "en"} label={t.hearThis} />
                           </div>
                           {arabicFirst ? (
                              <>
                                 <p dir="rtl" className="text-2xl leading-relaxed text-[#1f3740]">“{review.transcript}”</p>
                                 <p dir="ltr" className="mt-3 text-base text-[#54717a]">{review.translation}</p>
                              </>
                           ) : (
                              <>
                                 <p dir="ltr" className="text-2xl leading-relaxed text-[#1f3740]">“{review.translation}”</p>
                                 <p dir="rtl" className="mt-3 text-base text-[#54717a]">{review.transcript}</p>
                              </>
                           )}
                           {/* review.audioUrl is a client-side object URL of the just-recorded
                               Blob (see runTranscribe) — no server signed URL exists yet at
                               review time, so this plays back straight from the browser's
                               own memory, not through the API. */}
                           {review.audioUrl && <audio controls src={review.audioUrl} className="mt-4 w-full" aria-label={t.yourRecording} />}
                        </div>
                        <div className="mt-8 text-start max-w-sm mx-auto space-y-6">
                           <fieldset>
                              <legend className="mb-3 font-semibold text-[#1f3740]">{t.howWasToday}</legend>
                              <div className="flex gap-2">
                                 {Object.entries(M).map(([k, v]) => (
                                    <button type="button" data-testid={`button-mood-${k}`} onClick={() => setMood(k)} className={`flex-1 min-h-12 rounded-full border transition ${mood === k ? "bg-[#284c59] text-white border-[#284c59]" : "border-[#789a9b]/50 bg-white/40"}`} key={k}>{v[0]} {moodLabel[k]}</button>
                                 ))}
                              </div>
                           </fieldset>
                           <label className="block">
                              <span className="font-semibold text-[#1f3740] block mb-3">{t.shareWith}</span>
                              <select data-testid="select-review-visibility" value={share} onChange={(e) => setShare(e.target.value)} className="w-full min-h-12 rounded-2xl border border-[#789a9b]/50 bg-white/60 px-4 text-[#1f3740] outline-none focus:border-[#284c59]">
                                 <option value="circle">{t.visCircle}</option>
                                 <option value="family">{t.visFamily}</option>
                                 <option value="coordinator">{t.visCoordinator}</option>
                                 <option value="mood_only">{t.visMoodOnly}</option>
                              </select>
                           </label>
                        </div>
                     </>
                  ) : (
                     <div className={`mx-auto mt-12 grid h-28 w-28 place-items-center rounded-full bg-[#406b73] text-white ${recording ? "breathe" : ""}`}>
                        <Mic size={34} />
                     </div>
                  )}
               </div>
               <button data-testid="button-finish-recording" onClick={review ? save : finish} disabled={transcribing || (!recording && !review && !isDemo)} className="mx-auto min-h-12 rounded-2xl bg-[#284c59] px-7 text-white disabled:opacity-50">
                  {transcribing ? t.transcribing : review ? t.saveWords : recording ? t.imFinished : t.recording}
               </button>
            </div>
         )}

         {sheet === "share" && (
            <div className="fixed inset-0 z-10 bg-[#d5e8e5]/95 p-6 backdrop-blur-xl overflow-y-auto">
               <button data-testid="button-close-share" onClick={() => setSheet(null)} className="ms-auto block min-h-11">
                  <X />
               </button>
               <div className="mx-auto max-w-xl pb-10">
                  <h2 className="serif text-4xl">{t.whatIShared}</h2>
                  <p className="mt-2 text-sm text-[#54717a]">{t.alwaysSee}</p>
                  <div className="mt-6 space-y-3">
                     {data.checkins.map((c) => (
                        <div className="glass flex items-center justify-between rounded-2xl p-4" key={c.id}>
                           <span>{fmt(c.date)}</span>
                           <select value={c.visibility || "mood_only"} onChange={(e) => void updateVisibility(c.id, e.target.value as Visibility)} className="rounded-full border bg-white/40 p-1.5 outline-none">
                              <option value="circle">{t.visCircleShort}</option>
                              <option value="family">{t.visFamilyShort}</option>
                              <option value="coordinator">{t.visCoordShort}</option>
                              <option value="mood_only">{t.visMoodShort}</option>
                           </select>
                        </div>
                     ))}
                     {data.checkins.length === 0 && <p className="text-[#54717a]">{t.nothingShared}</p>}
                  </div>
               </div>
            </div>
         )}
      </main>
   );
}

function Loupe({ x, y, children }: { x: number; y: number; children: ReactNode }) {
   const L = 260;
   const K = 2;
   return createPortal(
      <div aria-hidden style={{ position: "fixed", left: x - L / 2, top: y - L / 2, width: L, height: L, borderRadius: "50%", overflow: "hidden", pointerEvents: "none", zIndex: 60, border: "3px solid rgba(40,76,89,.55)", boxShadow: "0 12px 44px rgba(46,84,91,.4)", background: "#d5e8e5" }}>
         <div style={{ position: "absolute", left: -(x - L / 2), top: -(y - L / 2), width: "100vw", height: "100vh", transform: `translate(${x * (1 - K)}px, ${y * (1 - K)}px) scale(${K})`, transformOrigin: "0 0" }}>
            <div className="ocean min-h-[100dvh] p-5">
               <div className="mx-auto flex min-h-[calc(100dvh-40px)] max-w-[1180px] flex-col">{children}</div>
            </div>
         </div>
      </div>,
      document.body,
   );
}

// ---------------------------------------------------------------------------

function DayCalendar({ value, visitDays, today, onChange }: { value: string; visitDays: string[]; today: string; onChange: (d: string) => void }) {
   const [open, setOpen] = useState(false);
   const [month, setMonth] = useState(() => (value || today || "2026-09-01").slice(0, 7));
   const btnRef = useRef<HTMLButtonElement | null>(null);
   const [pos, setPos] = useState({ top: 0, left: 0 });

   useEffect(() => {
      if (!open) return;
      const place = () => {
         const r = btnRef.current?.getBoundingClientRect();
         if (r) setPos({ top: Math.round(r.bottom + 8), left: Math.round(r.left) });
      };
      place();
      const close = () => setOpen(false);
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
      window.addEventListener("resize", place);
      window.addEventListener("scroll", close, true);
      document.addEventListener("keydown", onKey);
      return () => {
         window.removeEventListener("resize", place);
         window.removeEventListener("scroll", close, true);
         document.removeEventListener("keydown", onKey);
      };
   }, [open]);

   const [y, m] = month.split("-").map(Number);
   const first = new Date(y, m - 1, 1);
   const startDow = first.getDay();
   const dim = new Date(y, m, 0).getDate();
   const cells: (string | null)[] = [];
   for (let i = 0; i < startDow; i++) cells.push(null);
   for (let d = 1; d <= dim; d++) cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
   const visits = new Set(visitDays);
   const shiftMonth = (delta: number) => { const nm = new Date(y, m - 1 + delta, 1); setMonth(`${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, "0")}`); };
   const label = value ? new Date(value + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "Pick a day";

   return (
      <>
         <button ref={btnRef} type="button" data-testid="button-day-calendar" onClick={() => setOpen((o) => !o)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#789a9b]/50 bg-white/50 px-3 text-sm hover:bg-white/70">
            <CalendarDays size={16} /> {label}
         </button>
         {open && createPortal(
            <>
               <div className="fixed inset-0 z-[55]" onMouseDown={() => setOpen(false)} />
               <div className="popover-in fixed z-[60] w-[268px] rounded-2xl border border-white/70 bg-white/90 p-3 shadow-[0_18px_48px_rgba(46,84,91,.24)] backdrop-blur-xl" style={{ top: pos.top, left: pos.left }}>
                  <div className="mb-2 flex items-center justify-between">
                     <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/70"><ChevronLeft size={16} /></button>
                     <b className="text-sm">{first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
                     <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/70"><ChevronRight size={16} /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-[#54717a]">
                     {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i}>{d}</span>)}
                  </div>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                     {cells.map((c, i) => {
                        if (!c) return <span key={i} />;
                        const past = c < today;
                        const sel = c === value;
                        const isToday = c === today;
                        const hasVisit = visits.has(c);
                        return (
                           <button key={i} type="button" disabled={past} onClick={() => { onChange(c); setOpen(false); }}
                              className={`relative h-9 rounded-lg text-sm transition ${sel ? "bg-[#284c59] text-white" : past ? "text-[#b9c6c7] cursor-default" : "text-[#1f3740] hover:bg-white"} ${isToday && !sel ? "ring-1 ring-[#284c59]" : ""}`}>
                              {Number(c.slice(8))}
                              {hasVisit && !sel && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#2f6b4f]" />}
                           </button>
                        );
                     })}
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#54717a]">
                     <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2f6b4f]" /> has a visit
                  </p>
               </div>
            </>,
            document.body,
         )}
      </>
   );
}

function AddAdHoc({ onAdd }: { onAdd: (b: { title: string; time: string; category: TaskCategory; timeSensitive: boolean }) => void }) {
   const [open, setOpen] = useState(false);
   const [title, setTitle] = useState("");
   const [t, setT] = useState("15:00");
   const [cat, setCat] = useState<TaskCategory>("other");
   const timeSensitive = cat === "medication" || cat === "rest" || cat === "personal_care";
   if (!open) return <button onClick={() => setOpen(true)} className="mt-4 text-sm text-[#284c59] underline">+ Add something you did</button>;
   return (
      <div className="mt-4 flex flex-wrap items-end gap-2">
         <input type="time" value={t} onChange={(e) => setT(e.target.value)} className="min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/60 px-2 text-sm outline-none" />
         <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Helped her call her sister" className="min-h-10 flex-1 min-w-[10rem] rounded-xl border border-[#789a9b]/50 bg-white/60 px-3 text-sm outline-none focus:border-[#284c59]" />
         <select value={cat} onChange={(e) => setCat(e.target.value as TaskCategory)} className="min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/60 px-2 text-sm outline-none">
            {CAT_KEYS.map((k) => <option key={k} value={k}>{CAT[k].label}</option>)}
         </select>
         <button onClick={() => { if (title.trim()) { onAdd({ title: title.trim(), time: t, category: cat, timeSensitive }); setTitle(""); setOpen(false); } }} className="min-h-10 rounded-full bg-[#294e59] px-4 text-sm text-white hover:bg-[#1f3a44]">Add</button>
      </div>
   );
}

function Coordinator() {
   const { data, updateShift, addRoutine, updateRoutine, deleteRoutine, toggleTask, refreshTasks } = useApp();
   const { activeCircle } = useCircle();
   const cid = activeCircle!.id;
   const [selected, setSelected] = useState<string | null>(null);
   const [planMode, setPlanMode] = useState<"daily" | "weekly">("daily");
   const [planWd, setPlanWd] = useState<number>(() => new Date().getDay());
   const [openTask, setOpenTask] = useState<PlanRow | null>(null);
   const [openRoutine, setOpenRoutine] = useState<RoutineItem | null>(null);

   useEffect(() => {
      const iv = window.setInterval(() => void refreshTasks(), 5000);
      return () => window.clearInterval(iv);
   }, [refreshTasks]);

   const care = data.careSignal!;
   const caregivers = data.members.filter((m) => m.role === "caregiver");
   const doneCount = data.tasks.filter((t) => t.doneAt).length;
   const now = data.demoDate ? date(data.demoDate) : new Date();
   const future = data.shifts.filter((s) => date(s.start) >= now).sort((a, b) => +date(a.start) - +date(b.start));
   const day = care.days.find((d) => d.date === selected) || care.days[care.days.length - 1];

   // --- message a caregiver (one box, targets that caregiver's next visit) ---
   const [msgCg, setMsgCg] = useState<string>("");
   const [msgDraft, setMsgDraft] = useState<string | null>(null);
   const cgId = msgCg || caregivers[0]?.id || "";
   const cgShift = future.find((s) => s.caregiverId === cgId);
   const cgName = caregivers.find((p) => p.id === cgId)?.name ?? "";
   const savedNote = cgShift?.coordinatorNote ?? "";
   const msgVal = msgDraft ?? savedNote;
   const sendMsg = () => {
      if (!cgShift) return;
      void updateShift(cgShift.id, { coordinatorNote: msgVal });
      setMsgDraft(null);
   };

   // --- invite someone into this circle ---
   // There was no UI anywhere for this at all — POST /circles/:cid/invites
   // (server) and /invite/:token (the accept-side screen, Task 9) both
   // existed with nothing between them. Found during a review of the full
   // sign-up-through-accept flow; without this, a coordinator can create a
   // circle but never actually add anyone else to it.
   const [inviteEmail, setInviteEmail] = useState("");
   const [inviteRole, setInviteRole] = useState<CircleRole>("caregiver");
   const [inviteFamily, setInviteFamily] = useState(true);
   const [inviteBusy, setInviteBusy] = useState(false);
   const [inviteMsg, setInviteMsg] = useState<string | null>(null);
   const [inviteErr, setInviteErr] = useState<string | null>(null);
   const sendInvite = async () => {
      const email = inviteEmail.trim();
      if (!email) return;
      setInviteBusy(true); setInviteErr(null); setInviteMsg(null);
      try {
         await api.createInvites(cid, [{ email, role: inviteRole, isFamilyMember: inviteFamily }]);
         setInviteMsg(`Invite sent to ${email}.`);
         setInviteEmail("");
      } catch (e) {
         setInviteErr(e instanceof Error ? e.message : "Couldn’t send that invite.");
      } finally {
         setInviteBusy(false);
      }
   };

   // --- upcoming: one day at a time (pick any day from today on) ---
   const [pickDay, setPickDay] = useState<string>("");
   const upDays = Array.from(new Set(future.map((s) => s.start.slice(0, 10))));
   const activeDay = pickDay || upDays[0] || data.demoDate;
   const dayShifts = future.filter((s) => s.start.slice(0, 10) === activeDay);

   return (
      <main className="ocean min-h-screen p-5 md:p-10">
         <div className="mx-auto max-w-[1180px]">
            <Brand label="Care coordination" />
            {/* care.callout doesn't exist on the wire (CareSignal has no such
                field in the new API) — this was always a fallback-only
                headline in practice, so it's just the static text now. */}
            <h1 className="serif py-10 text-5xl md:text-7xl">A quieter week — no clear pattern yet.</h1>

            <section className="glass rounded-3xl p-6">
               <h2 className="serif text-2xl">Mood ribbon</h2>
               <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {care.days.map((d) => (
                     <button data-testid={`button-day-${d.date}`} onClick={() => setSelected(d.date)} className={`min-h-[92px] rounded-2xl border p-3 text-left transition ${selected === d.date ? "bg-white/65 border-white shadow-[0_4px_12px_rgba(0,0,0,0.05)]" : "bg-white/35 border-[#789a9b]/30 hover:bg-white/50"}`} key={d.date}>
                        <p className="text-xs text-[#54717a]">{new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</p>
                        <span className="mt-3 block"><MoodTag mood={d.mood} size="sm" /></span>
                     </button>
                  ))}
               </div>
               {day && (
                  <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#789a9b]/30 pt-4">
                     <b>{fmt(day.date)}</b>
                     <MoodTag mood={day.mood} size="sm" />
                     <span className="text-sm text-[#54717a]">
                        {day.noteHidden ? "Her note is private." : "A note is available to the people she chose."}
                        {day.shifts.length ? " · " + day.shifts.map((s) => `${s.caregiverName ?? "Unassigned"} · ${s.tags.join(", ")}`).join("  |  ") : ""}
                     </span>
                  </div>
               )}
            </section>

            <section className="glass mt-7 rounded-3xl p-6">
               <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="serif text-2xl">Care plan</h2>
                  <div className="flex rounded-full border border-[#789a9b]/40 bg-white/40 p-0.5">
                     <button onClick={() => setPlanMode("daily")} className={`min-h-9 rounded-full px-4 text-sm font-medium ${planMode === "daily" ? "bg-[#284c59] text-white" : ""}`}>Daily</button>
                     <button onClick={() => setPlanMode("weekly")} className={`min-h-9 rounded-full px-4 text-sm font-medium ${planMode === "weekly" ? "bg-[#284c59] text-white" : ""}`}>Weekly</button>
                  </div>
               </div>

               {planMode === "daily" ? (
                  <>
                     <p className="mt-1 text-sm text-[#54717a]">{doneCount} of {data.tasks.length} done · updates live as caregivers tick them</p>
                     <div className="mt-4"><TaskList tasks={data.tasks} canCheck onToggle={toggleTask} onOpen={setOpenTask} /></div>
                  </>
               ) : (
                  <>
                     <p className="mt-1 text-sm text-[#54717a]">Set up the standing routine — each day’s checklist is built from this.</p>
                     <RoutinePlanner routine={data.routine} selectedWd={planWd} setSelectedWd={setPlanWd} onAdd={(b) => void addRoutine(b)} onOpen={setOpenRoutine} />
                  </>
               )}
            </section>

            {openTask && <TaskCard row={openTask} canCheck onToggle={toggleTask} onClose={() => setOpenTask(null)} />}
            {openRoutine && <RoutineCard item={openRoutine} onSave={(p) => void updateRoutine(openRoutine.id, p)} onDelete={() => void deleteRoutine(openRoutine.id)} onClose={() => setOpenRoutine(null)} />}

            {/* "Suggested move" removed entirely (Q2) — it had no data source
                in the new API (no correlation/pattern-insight endpoint
                exists). The section wrapper's lg:grid-cols-2 is gone with
                it — Upcoming is the only thing left here now. */}
            <section className="mt-7">
               <article className="glass rounded-3xl p-6 max-w-xl">
                  <h2 className="serif text-2xl">Upcoming</h2>
                  <div className="mt-4">
                     <DayCalendar value={activeDay} visitDays={upDays} today={data.demoDate} onChange={setPickDay} />
                  </div>
                  {dayShifts.length === 0 && (
                     <p className="mt-4 text-sm text-[#54717a]">No visit scheduled for this day.</p>
                  )}
                  {dayShifts.map((s) => (
                     <div className="mt-4 border-t border-[#789a9b]/30 pt-4" key={s.id}>
                        <p>{time(s.start)} — {time(s.end)} · {s.caregiverName ?? "Unassigned"}</p>
                        <p className="text-sm text-[#42616a]">{s.purpose} · {s.activityTags.join(", ")}</p>
                        <select className="mt-3 rounded-xl border border-[#789a9b]/50 bg-white/40 p-2 outline-none w-full max-w-xs" value={s.caregiverId || ""} onChange={(e) => void updateShift(s.id, { caregiverId: e.target.value || null })}>
                           <option value="">Unassigned</option>
                           {caregivers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                     </div>
                  ))}
               </article>
            </section>

            <section className="glass mt-7 rounded-3xl border-2 border-[#284c59]/25 p-6">
               <h2 className="serif flex items-center gap-2 text-2xl"><MessageSquare size={22} className="text-[#284c59]" /> Message a caregiver</h2>
               <p className="mt-1 text-sm text-[#54717a]">Goes to their next visit{cgShift ? ` · ${fmt(cgShift.start)}` : ""}. They see it in their briefing.</p>
               <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="block">
                     <span className="block text-sm text-[#54717a] mb-1.5">To</span>
                     <select data-testid="select-message-caregiver" value={cgId} onChange={(e) => { setMsgCg(e.target.value); setMsgDraft(null); }} className="min-h-11 rounded-xl border border-[#789a9b]/50 bg-white/60 p-2 outline-none focus:border-[#284c59]">
                        {caregivers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                     </select>
                  </label>
                  <input
                     data-testid="input-caregiver-note"
                     value={msgVal}
                     onChange={(e) => setMsgDraft(e.target.value)}
                     placeholder={cgShift ? "e.g. more time in the garden — it lifts her" : `${cgName} has no upcoming visit`}
                     disabled={!cgShift}
                     className="flex-1 min-h-11 rounded-xl border border-[#789a9b]/50 bg-white/60 px-3 text-[#1f3740] outline-none focus:border-[#284c59] disabled:opacity-50"
                  />
                  <button
                     data-testid="button-send-caregiver-note"
                     onClick={sendMsg}
                     disabled={!cgShift || msgVal.trim() === savedNote}
                     className="min-h-11 rounded-full bg-[#294e59] px-5 text-white disabled:opacity-40 transition hover:bg-[#1f3a44]"
                  >
                     Send
                  </button>
               </div>
               {savedNote && msgDraft === null && <p className="mt-3 text-sm text-[#42616a]">Sent to {cgName}: “{savedNote}”</p>}
            </section>

            <section className="glass mt-7 rounded-3xl p-6">
               <h2 className="serif text-2xl">Invite someone</h2>
               <p className="mt-1 text-sm text-[#54717a]">They'll get an email with a link to join this circle.</p>
               <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="block flex-1">
                     <span className="block text-sm text-[#54717a] mb-1.5">Email</span>
                     <input
                        data-testid="input-invite-email"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => { setInviteEmail(e.target.value); setInviteErr(null); }}
                        placeholder="them@example.com"
                        className="w-full min-h-11 rounded-xl border border-[#789a9b]/50 bg-white/60 px-3 text-[#1f3740] outline-none focus:border-[#284c59]"
                     />
                  </label>
                  <label className="block">
                     <span className="block text-sm text-[#54717a] mb-1.5">As</span>
                     <select
                        data-testid="select-invite-role"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value as CircleRole)}
                        className="min-h-11 rounded-xl border border-[#789a9b]/50 bg-white/60 p-2 outline-none focus:border-[#284c59]"
                     >
                        <option value="caregiver">Caregiver</option>
                        <option value="family">Family</option>
                        <option value="coordinator">Coordinator</option>
                     </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[#54717a] sm:pb-2.5">
                     <input type="checkbox" checked={inviteFamily} onChange={(e) => setInviteFamily(e.target.checked)} />
                     Family member
                  </label>
                  <button
                     data-testid="button-send-invite"
                     onClick={() => void sendInvite()}
                     disabled={inviteBusy || !inviteEmail.trim()}
                     className="min-h-11 rounded-full bg-[#294e59] px-5 text-white disabled:opacity-40 transition hover:bg-[#1f3a44]"
                  >
                     {inviteBusy ? "Sending…" : "Send invite"}
                  </button>
               </div>
               {inviteErr && <p role="alert" className="mt-3 text-sm text-[#8a2f24]">{inviteErr}</p>}
               {inviteMsg && <p className="mt-3 text-sm text-[#2f6b4f]">{inviteMsg}</p>}
            </section>

            <Footer />
         </div>
      </main>
   );
}

// ---------------------------------------------------------------------------

function Caregiver() {
   const { data, toggleTask, addAdHoc, deleteAdHoc, refreshTasks } = useApp();
   const { activeCircle } = useCircle();
   // data.myShifts is already filtered to the active circle and sorted by
   // start (AppProvider) — [0] is simply the next upcoming one.
   const myShift = data.myShifts[0] ?? null;
   const s = myShift; // start/end/purpose/coordinatorNote
   const c = myShift?.context ?? null;
   const doneCount = data.tasks.filter((t) => t.doneAt).length;
   const [openTask, setOpenTask] = useState<PlanRow | null>(null);

   useEffect(() => {
      const iv = window.setInterval(() => void refreshTasks(), 6000);
      return () => window.clearInterval(iv);
   }, [refreshTasks]);

   return (
      <main className="ocean min-h-screen p-5 md:p-10">
         <div className="mx-auto max-w-[1100px]">
            <Brand label="Your care view" />
            <h1 className="serif pt-12 pb-3 text-5xl md:text-7xl">A little context<br />before you start.</h1>
            {s && <p className="pb-8 text-[#54717a]"><Clock3 className="mr-2 inline" size={16} />{fmt(s.start)} · {time(s.start)} — {time(s.end)}</p>}
            {s ? (
               <>
                  <section className="grid gap-6 lg:grid-cols-2">
                     <article className="glass rounded-3xl p-7">
                        {/* circles.name is always set equal to elder_name at
                            creation (circles.ts's POST /circles) — activeCircle.name
                            IS the elder's name, not a separate field. */}
                        <p>From {activeCircle!.name} · {c?.mood && M[c.mood][1]}</p>
                        <Quote className="mt-8 text-[#54717a]" />
                        <p className="serif mt-3 text-3xl text-[#1f3740]">“{c?.noteHidden ? "She kept the details private." : c?.excerpt || "No note was shared for this shift."}”</p>
                     </article>
                     <article className="glass rounded-3xl p-7">
                        <p>From your coordinator</p>
                        <Quote className="mt-8 text-[#54717a]" />
                        <p className="serif mt-3 text-3xl text-[#1f3740]">“{s.coordinatorNote?.trim() || "No note for this shift."}”</p>
                     </article>
                  </section>

                  <article className="glass mt-6 rounded-3xl p-7">
                     <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="serif text-3xl">Today’s care plan</h2>
                        <span className="text-sm text-[#54717a]">{doneCount} of {data.tasks.length} done</span>
                     </div>
                     <p className="mt-1 text-sm text-[#54717a]">Tick each one as you do it — the time is recorded. Tap a task for details.</p>
                     <div className="mt-4"><TaskList tasks={data.tasks} canCheck onToggle={toggleTask} onOpen={setOpenTask} /></div>
                     <AddAdHoc onAdd={(b) => void addAdHoc(b)} />
                  </article>
                  {openTask && <TaskCard row={openTask} canCheck onToggle={toggleTask} onDeleteAdHoc={deleteAdHoc} onClose={() => setOpenTask(null)} />}
               </>
            ) : (
               <div className="glass rounded-3xl p-7">There is no upcoming shift assigned to you right now.</div>
            )}
            <Footer />
         </div>
      </main>
   );
}

// ---------------------------------------------------------------------------

function Family() {
   const { data, refreshTasks } = useApp();
   const { activeCircle } = useCircle();
   const cid = activeCircle!.id;
   const audio = useRef<HTMLAudioElement | null>(null);
   const [playing, setPlaying] = useState<string | null>(null);
   const [playErr, setPlayErr] = useState<string | null>(null);
   const [tab, setTab] = useState<"words" | "plan">("words");
   const [openTask, setOpenTask] = useState<PlanRow | null>(null);
   const checkins = data.checkins;
   const doneCount = data.tasks.filter((t) => t.doneAt).length;

   useEffect(() => {
      const iv = window.setInterval(() => void refreshTasks(), 5000);
      return () => window.clearInterval(iv);
   }, [refreshTasks]);

   // Pause whatever's playing on unmount (navigating away mid-playback
   // otherwise leaves it running in the background — the audio element
   // isn't attached to anything the router unmounts on its own).
   useEffect(() => () => audio.current?.pause(), []);

   // The checkin list no longer carries a ready-to-play audioUrl — audio_path
   // is only ever exposed as a 120s signed URL, fetched on demand
   // (GET /checkins/:id/audio), not embedded in every list response.
   const play = async (id: string) => {
      if (playing === id) { audio.current?.pause(); setPlaying(null); return; }
      if (audio.current) audio.current.pause();
      setPlayErr(null);
      try {
         const { url } = await api.checkinAudioUrl(cid, id);
         const a = new Audio(url);
         audio.current = a;
         a.onended = () => setPlaying(null);
         await a.play();
         setPlaying(id);
      } catch {
         // Previously silent — the button would just revert with no
         // explanation on a network blip or an expired signed URL.
         setPlayErr("Couldn’t play that recording. Please try again.");
         setPlaying(null);
      }
   };

   const tabCls = (on: boolean) => `min-h-11 rounded-full px-4 text-sm font-medium transition ${on ? "bg-[#284c59] text-white" : "border border-[#789a9b]/50 bg-white/40 hover:bg-white/60"}`;

   return (
      <main className="ocean min-h-screen p-5 md:p-10">
         <div className="mx-auto max-w-[1100px]">
            <Brand label="Family view" />
            <div className="flex gap-2 py-8">
               <button data-testid="tab-words" onClick={() => setTab("words")} className={tabCls(tab === "words")}>Her words</button>
               <button data-testid="tab-plan" onClick={() => setTab("plan")} className={tabCls(tab === "plan")}>Today’s plan</button>
            </div>

            {tab === "words" ? (
               <>
                  <h1 className="serif pb-6 text-4xl md:text-6xl">Her own words, each evening.</h1>
                  {playErr && <p role="alert" className="mb-4 text-sm text-[#8a2f24]">{playErr}</p>}
                  {checkins.map((c) => (
                     <article className="glass mb-4 rounded-3xl p-6 md:grid md:grid-cols-[190px_1fr]" key={c.id}>
                        <div>
                           <p className="text-[#54717a]">{fmt(c.date)}</p>
                           <span className="mt-2 block">{c.mood ? <MoodTag mood={c.mood} size="sm" /> : <span className="text-sm text-[#54717a]">No mood shared</span>}</span>
                        </div>
                        {/* RLS already did the visibility-tier filtering server-side
                            (GET /checkins' checkin_content join returns null
                            transcript/translation when this viewer isn't
                            permitted) — a present transcript IS "not hidden,"
                            there's no separate flag to check anymore. */}
                        {c.transcript ? (
                           <div className="mt-4 md:mt-0">
                              <p className="serif text-2xl text-[#1f3740]">“{c.translation || c.transcript}”</p>
                              {c.hasAudio && (
                                 <button data-testid={`button-play-${c.id}`} onClick={() => void play(c.id)} className="mt-4 min-h-11 rounded-full border border-[#789a9b]/50 px-4 hover:bg-white/40 transition">
                                    {playing === c.id ? <Volume2 className="mr-2 inline" size={17} /> : <Play className="mr-2 inline" size={17} />}
                                    {playing === c.id ? "Playing her words" : "Play her words"}
                                 </button>
                              )}
                           </div>
                        ) : (
                           <p className="mt-4 text-lg text-[#54717a] md:mt-0">She kept this note private. Her mood still shows.</p>
                        )}
                     </article>
                  ))}
                  {checkins.length === 0 && <p className="text-[#54717a]">No check-ins yet.</p>}
               </>
            ) : (
               <section className="glass rounded-3xl p-7">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                     <h1 className="serif text-4xl md:text-5xl">Today’s plan</h1>
                     <span className="text-sm text-[#54717a]">{doneCount} of {data.tasks.length} done</span>
                  </div>
                  <p className="mt-2 text-sm text-[#54717a]">What’s planned for her day, and what’s been done — with the time, where it matters.</p>
                  <div className="mt-5"><TaskList tasks={data.tasks} canCheck={false} onOpen={setOpenTask} /></div>
                  {openTask && <TaskCard row={openTask} canCheck={false} onToggle={() => {}} onClose={() => setOpenTask(null)} />}
               </section>
            )}
            <Footer />
         </div>
      </main>
   );
}

// ---------------------------------------------------------------------------

// Login is gone — SignIn.tsx (magic-link only, Q1) replaces it entirely.
// ResetKey is gone too — the hidden Ctrl+Shift+R demo-reset shortcut called
// POST /api/demo/reset, which no longer exists server-side (Q4, confirmed:
// remove rather than repoint to a "new demo circle" flow).

// Each role route is: RequireCircle (circle.tsx — session/notice/circle/role
// gate) wrapping AppProvider (this file — role-specific data fetch) wrapping
// RequireData (this file — holds the screen until that first fetch
// resolves) wrapping the actual screen. Three distinct, single-purpose
// gates, not one monolithic one — RequireRole used to do all of this
// itself, which was exactly the case for TypeScript to lose track of
// (session existing, matching role, AND data being loaded were nested
// invariants a monolithic component just implicitly assumed rather than
// declared step-by-step, harder to verify or extend than they need to be)
function RoleRoute({ role, children }: { role: CircleRole; children: ReactNode }) {
   return (
      <RequireCircle role={role}>
         <AppProvider>
            <RequireData>{children}</RequireData>
         </AppProvider>
      </RequireCircle>
   );
}

function App() {
   return (
      <CircleProvider>
         <Switch>
            <Route path="/" component={SignIn} />
            <Route path="/privacy-notice" component={PrivacyNotice} />
            <Route path="/create-circle" component={CreateCircle} />
            <Route path="/invite/:token" component={AcceptInvite} />
            <Route path="/elder"><RoleRoute role="elder"><Elder /></RoleRoute></Route>
            <Route path="/coordinator"><RoleRoute role="coordinator"><Coordinator /></RoleRoute></Route>
            <Route path="/caregiver"><RoleRoute role="caregiver"><Caregiver /></RoleRoute></Route>
            <Route path="/family"><RoleRoute role="family"><Family /></RoleRoute></Route>
            <Route>
               <main className="ocean min-h-screen p-6 grid place-items-center">
                  <p className="serif text-xl">Not found.</p>
               </main>
            </Route>
         </Switch>
      </CircleProvider>
   );
}

export default App;
