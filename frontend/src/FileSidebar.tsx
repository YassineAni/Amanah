import { useEffect, useRef, useState } from "react";
import { Download, FileText, Lock, Paperclip, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { api, ApiError, type ClinicalFile, type FileCategory, type FileVisibility } from "./api";

// sensitivity tier per visibility — glyph + word carry it, colour reinforces
const SENS: Record<FileVisibility, { word: string; glyph: string; cls: string; needsConfirm: boolean }> = {
   circle: { word: "Shared", glyph: "○", cls: "text-[#2f6b4f]", needsConfirm: false },
   family: { word: "Family", glyph: "◐", cls: "text-[#b7791f]", needsConfirm: false },
   coordinator: { word: "Restricted", glyph: "●", cls: "text-[#a23b2e]", needsConfirm: true },
};

function Sensitivity({ v }: { v: FileVisibility }) {
   const s = SENS[v];
   return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}>
         <span aria-hidden>{s.glyph}</span>
         {s.word}
         {v === "coordinator" && <Lock size={11} aria-hidden />}
      </span>
   );
}

function ScanCleared() {
   return (
      <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
         <svg width="56" height="56" viewBox="0 0 56 56" className="scan-ok" aria-hidden>
            <circle className="ring" cx="28" cy="28" r="14" fill="none" stroke="#2f6b4f" strokeWidth="3" strokeLinecap="round" transform="rotate(-90 28 28)" />
            <path className="tick" d="M20 28.5 L25.5 34 L36 22" fill="none" stroke="#2f6b4f" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
         </svg>
         <p className="text-sm font-medium text-[#2f6b4f]">No viruses or corruption found</p>
         <p className="text-xs text-[#54717a]">Document added to the circle.</p>
      </div>
   );
}

const CATS: { v: FileCategory; label: string }[] = [
   { v: "discharge", label: "Discharge summary" },
   { v: "prescription", label: "Prescription" },
   { v: "lab", label: "Lab result" },
   { v: "imaging", label: "Imaging" },
   { v: "care-plan", label: "Care plan" },
   { v: "other", label: "Other" },
];
const VIS: { v: FileVisibility; label: string }[] = [
   { v: "circle", label: "Everyone in the circle" },
   { v: "family", label: "Family only" },
   { v: "coordinator", label: "Coordinator only" },
];
const catLabel = (v: string) => CATS.find((c) => c.v === v)?.label ?? "Document";
const visLabel = (v: string) => VIS.find((c) => c.v === v)?.label ?? v;
const kb = (n: number) => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);
const shortDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function FileSidebar() {
   const [open, setOpen] = useState(false);
   const [files, setFiles] = useState<ClinicalFile[]>([]);
   const [canUpload, setCanUpload] = useState(false);
   const [loading, setLoading] = useState(false);
   const [err, setErr] = useState<string | null>(null);
   const [busy, setBusy] = useState(false);
   const [confirmId, setConfirmId] = useState<string | null>(null);
   const [scanCleared, setScanCleared] = useState(false);

   // upload form
   const fileInput = useRef<HTMLInputElement | null>(null);
   const [pending, setPending] = useState<File | null>(null);
   const [uName, setUName] = useState("");
   const [uCat, setUCat] = useState<FileCategory>("discharge");
   const [uVis, setUVis] = useState<FileVisibility>("family");

   const load = async () => {
      setLoading(true);
      setErr(null);
      try {
         const r = await api.files();
         setFiles(r.files);
         setCanUpload(r.canUpload);
      } catch (e) {
         setErr(e instanceof ApiError ? e.message : "Couldn’t load files.");
      } finally {
         setLoading(false);
      }
   };

   useEffect(() => {
      if (open) void load();
   }, [open]);

   useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
   }, []);

   const openNow = async (f: ClinicalFile) => {
      setConfirmId(null);
      try {
         const blob = await api.downloadFile(f.id);
         const url = URL.createObjectURL(blob);
         window.open(url, "_blank", "noopener");
         setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
         setErr("Couldn’t open that document.");
      }
   };
   const view = (f: ClinicalFile) => {
      if (SENS[f.visibility].needsConfirm) setConfirmId(f.id);
      else void openNow(f);
   };

   const upload = async () => {
      if (!pending) return;
      setBusy(true);
      setErr(null);
      try {
         await api.uploadFile(pending, { name: uName.trim() || pending.name, category: uCat, visibility: uVis });
         setPending(null);
         setUName("");
         if (fileInput.current) fileInput.current.value = "";
         setScanCleared(true);
         window.setTimeout(() => setScanCleared(false), 2600);
         await load();
      } catch (e) {
         setErr(e instanceof ApiError ? `Blocked: ${e.message}` : "Upload failed.");
      } finally {
         setBusy(false);
      }
   };

   const patch = async (f: ClinicalFile, meta: Partial<{ category: FileCategory; visibility: FileVisibility }>) => {
      setFiles((list) => list.map((x) => (x.id === f.id ? { ...x, ...meta } : x)));
      try {
         await api.updateFile(f.id, meta);
      } catch {
         void load();
      }
   };

   const remove = async (f: ClinicalFile) => {
      setFiles((list) => list.filter((x) => x.id !== f.id));
      try {
         await api.deleteFile(f.id);
      } catch {
         void load();
      }
   };

   return (
      <>
         {/* edge handle */}
         <button
            data-testid="button-open-files"
            onClick={() => setOpen(true)}
            aria-label="Clinical files"
            className="fixed right-0 top-1/2 z-20 -translate-y-1/2 flex items-center gap-2 rounded-l-2xl border border-white/70 border-r-0 bg-white/45 py-4 pl-4 pr-3 text-sm font-medium text-[#1f3740] shadow-[0_18px_48px_rgba(46,84,91,.12)] backdrop-blur-xl transition hover:bg-white/65"
         >
            <Paperclip size={18} /> Files
         </button>

         {/* backdrop */}
         {open && <div className="fixed inset-0 z-30 bg-[#1f3740]/10" onClick={() => setOpen(false)} />}

         {/* the bubble */}
         <aside
            className={`fixed right-0 top-0 z-40 h-full w-full max-w-[400px] p-3 transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-[108%]"}`}
            aria-hidden={!open}
         >
            <div className="flex h-full flex-col overflow-hidden rounded-[32px] border border-white/70 bg-white/55 shadow-[inset_0_1px_1px_rgba(255,255,255,.9),0_24px_60px_rgba(46,84,91,.18)] backdrop-blur-2xl">
               <header className="flex items-center justify-between px-6 pt-6">
                  <h2 className="serif text-2xl text-[#1f3740]">Clinical files</h2>
                  <button data-testid="button-close-files" onClick={() => setOpen(false)} aria-label="Close" className="min-h-10 min-w-10 grid place-items-center rounded-full hover:bg-white/50">
                     <X size={20} />
                  </button>
               </header>
               <p className="px-6 pt-1 text-sm text-[#54717a]">
                  Stored as-is. Her Day doesn’t read or interpret documents.
               </p>

               <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {loading && <p className="px-2 text-[#54717a]">Loading…</p>}
                  {err && <p role="alert" className="mx-2 rounded-2xl border border-[#a23b2e]/40 bg-[#a23b2e]/10 px-3 py-2 text-sm text-[#8a2f24]">{err}</p>}
                  {!loading && files.length === 0 && !err && <p className="px-2 text-[#54717a]">No documents you can see.</p>}

                  {files.map((f) => (
                     <div key={f.id} className="rounded-2xl border border-white/70 bg-white/45 p-4">
                        <div className="flex items-start gap-3">
                           <FileText size={20} className="mt-0.5 shrink-0 text-[#54717a]" />
                           <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-[#1f3740]" title={f.name}>{f.name}</p>
                              <p className="mt-0.5 text-xs text-[#54717a]">
                                 {catLabel(f.category)} · {kb(f.size)} · {f.uploadedByName} · {shortDate(f.uploadedAt)}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                 <Sensitivity v={f.visibility} />
                                 {f.scannedClean && (
                                    <span className="inline-flex items-center gap-1 text-xs text-[#2f6b4f]">
                                       <ShieldCheck size={12} aria-hidden /> Scanned
                                    </span>
                                 )}
                              </div>
                           </div>
                        </div>

                        {confirmId === f.id ? (
                           <div className="mt-3 rounded-2xl border border-[#a23b2e]/30 bg-[#a23b2e]/5 p-3">
                              <p className="text-sm text-[#8a2f24]">
                                 This is a <b>restricted</b> document. Open it?
                              </p>
                              <div className="mt-2 flex gap-2">
                                 <button onClick={() => setConfirmId(null)} className="min-h-9 rounded-full border border-[#789a9b]/50 bg-white/60 px-3 text-sm hover:bg-white/80">Cancel</button>
                                 <button data-testid={`button-confirm-open-${f.id}`} onClick={() => void openNow(f)} className="min-h-9 rounded-full bg-[#294e59] px-3 text-sm text-white hover:bg-[#1f3a44]">Yes, open</button>
                              </div>
                           </div>
                        ) : (
                           <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button data-testid={`button-view-${f.id}`} onClick={() => view(f)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#789a9b]/50 bg-white/50 px-3 text-sm hover:bg-white/70">
                                 <Download size={15} /> View
                              </button>
                              {f.canManage && (
                                 <>
                                    <select value={f.visibility} onChange={(e) => void patch(f, { visibility: e.target.value as FileVisibility })} className="min-h-9 rounded-full border border-[#789a9b]/50 bg-white/50 px-2 text-sm outline-none">
                                       {VIS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                                    </select>
                                    <button data-testid={`button-delete-${f.id}`} onClick={() => void remove(f)} aria-label="Delete" className="min-h-9 min-w-9 grid place-items-center rounded-full border border-[#789a9b]/50 bg-white/50 text-[#8a2f24] hover:bg-white/70">
                                       <Trash2 size={15} />
                                    </button>
                                 </>
                              )}
                           </div>
                        )}
                     </div>
                  ))}
               </div>

               {canUpload && (
                  <div className="border-t border-white/60 bg-white/40 p-4">
                     {scanCleared ? (
                        <ScanCleared />
                     ) : (
                     <><p className="mb-2 text-sm font-medium text-[#1f3740]">Add a document</p>
                     <input
                        ref={fileInput}
                        data-testid="input-file"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt"
                        onChange={(e) => { const f = e.target.files?.[0] ?? null; setPending(f); if (f && !uName) setUName(f.name); }}
                        className="w-full text-sm"
                     />
                     {pending && (
                        <div className="mt-3 space-y-2">
                           <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Name" className="w-full min-h-10 rounded-xl border border-[#789a9b]/50 bg-white/70 px-3 text-sm outline-none focus:border-[#284c59]" />
                           <div className="flex gap-2">
                              <select value={uCat} onChange={(e) => setUCat(e.target.value as FileCategory)} className="min-h-10 flex-1 rounded-xl border border-[#789a9b]/50 bg-white/70 px-2 text-sm outline-none">
                                 {CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                              </select>
                              <select value={uVis} onChange={(e) => setUVis(e.target.value as FileVisibility)} className="min-h-10 flex-1 rounded-xl border border-[#789a9b]/50 bg-white/70 px-2 text-sm outline-none">
                                 {VIS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                              </select>
                           </div>
                           <p className="flex items-center gap-2 text-xs text-[#54717a]">
                              Sensitivity: <Sensitivity v={uVis} /> · checked for viruses & corruption on upload
                           </p>
                           <button data-testid="button-upload" onClick={() => void upload()} disabled={busy} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-[#294e59] px-4 text-sm text-white disabled:opacity-50 hover:bg-[#1f3a44]">
                              <Upload size={15} /> {busy ? "Scanning & uploading…" : "Upload"}
                           </button>
                        </div>
                     )}
                     </>
                     )}
                  </div>
               )}
            </div>
         </aside>
      </>
   );
}
