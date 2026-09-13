import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { api } from "../api";
import { homeFor, useCircle } from "../circle";

// Shown when a signed-in, notice-accepted user has zero circles (Q6,
// confirmed: straight to this screen, no "you're not in a circle yet"
// landing first).
export function CreateCircle() {
  const { activeCircle, refresh } = useCircle();
  const [, setLocation] = useLocation();

  // Guard against re-entry once a circle already exists — this screen is
  // reachable via a stale link/back-button, and without this the form would
  // just create a SECOND circle. Also closes a related gap: since
  // activeCircle is always circles[0] ordered by creation time (Q7 — no
  // switcher), a newly created circle is never circles[0] for a user who
  // already had one, so "create another circle" would silently strand them
  // on a screen that redirects to their OLD circle's role, not the one they
  // just made.
  if (activeCircle) return <Redirect to={homeFor(activeCircle.role)} />;
  const [elderName, setElderName] = useState("");
  const [elderLang, setElderLang] = useState<"ar" | "en" | "fr">("ar");
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-detected, not asked — the coordinator creating a circle is almost
  // always in the same timezone as the elder for a family pilot, and a
  // 400-entry IANA-zone picker is real added UI for a case that's rare in
  // practice. Sent as-is to POST /circles, which validates it's a real IANA
  // zone (Intl.supportedValuesOf("timeZone")) — the browser's own detected
  // zone always satisfies that.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = async () => {
    const name = elderName.trim();
    if (!name || !attest) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createCircle({ elderName: name, elderLang, timezone, attestation: true });
      await refresh();
      setLocation("/coordinator"); // creating a circle always makes you its coordinator
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t create the circle — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ocean min-h-[100dvh] p-5 md:p-10 flex flex-col">
      <div className="mx-auto max-w-md w-full flex-1 flex flex-col justify-center">
        <h1 className="serif text-4xl md:text-5xl text-[#1f3740] text-center mb-2">Set up her circle</h1>
        <p className="text-center text-[#54717a] mb-8">Just a couple of details to get started.</p>

        <div className="glass rounded-[28px] p-6 space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-[#1f3740] block mb-1.5">Her name</span>
            <input
              data-testid="input-elder-name"
              value={elderName}
              onChange={(e) => { setElderName(e.target.value); setErr(null); }}
              placeholder="e.g. Fatima"
              className="w-full min-h-12 rounded-2xl border border-[#789a9b]/50 bg-white/60 px-4 text-[#1f3740] outline-none focus:border-[#284c59]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-[#1f3740] block mb-1.5">Her language</span>
            <select
              data-testid="select-elder-lang"
              value={elderLang}
              onChange={(e) => setElderLang(e.target.value as typeof elderLang)}
              className="w-full min-h-12 rounded-2xl border border-[#789a9b]/50 bg-white/60 px-4 text-[#1f3740] outline-none focus:border-[#284c59]"
            >
              <option value="ar">Arabic</option>
              <option value="en">English</option>
              <option value="fr">French</option>
            </select>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-[#33515a]">
            <input
              data-testid="checkbox-attestation"
              type="checkbox"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
              className="mt-0.5"
            />
            <span>I have the authority to arrange care for her — I'm her family, or she's asked me to coordinate this.</span>
          </label>
          {err && (
            <p role="alert" className="rounded-2xl border border-[#a23b2e]/40 bg-[#a23b2e]/10 px-4 py-3 text-sm text-[#8a2f24]">
              {err}
            </p>
          )}
          <button
            data-testid="button-create-circle"
            onClick={() => void submit()}
            disabled={busy || !elderName.trim() || !attest}
            className="w-full min-h-12 rounded-2xl bg-[#284c59] text-[#f7f5ed] transition hover:bg-[#1f3a44] disabled:opacity-50"
          >
            {busy ? "Setting up…" : "Create her circle"}
          </button>
        </div>
      </div>
    </main>
  );
}
