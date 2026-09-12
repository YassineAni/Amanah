import { useState } from "react";
import { Redirect } from "wouter";
import { api } from "../api";
import { useCircle } from "../circle";

// Bump this whenever NOTICE's substance changes — profiles.privacy_notice_version
// records which version a person actually agreed to. Single source of truth:
// docs/pilot-privacy-assessment.md (Task 15) cross-checks against this
// literal export, not the other way around.
export const PRIVACY_NOTICE_VERSION = "2026-09-1c-v1";

const NOTICE = `
Before you (or the family you're setting up) use Amanah, here's what actually
happens with what you share.

**What we collect.** A nightly voice check-in (the recording and a
transcript), who came and what they did during a visit, and a weekly care
plan. Nothing else is collected about the elder.

**Who can see it.** Every check-in has a visibility setting the elder (or
whoever records it) chooses each time: her whole circle, just family, just
the coordinator, or mood only (no note, no recording, no transcript — just
whether the day was good, steady, or hard). That setting is enforced by the
database itself, not just by what the app's screens choose to show.

**Where the recording goes.** The audio and transcript are sent to OpenAI
(api.openai.com, hosted in the United States) to produce the transcript and
translation. OpenAI does not use this audio to train its models and retains
it for 30 days for abuse monitoring, then deletes it. The recording itself
is stored privately and is never public.

**How long we keep it.** Everything is kept until the family's circle is
deleted. Deleting a circle deletes its check-ins, recordings, schedule, and
membership — this cannot be undone.

**Your rights.** Anyone in a circle can ask its coordinator to delete their
own check-ins, or to delete the whole circle. We aim to complete a deletion
request within 7 days.

**Who is attesting to what.** Creating a circle means attesting that you
have the authority to arrange care for the elder named in it — as the elder
themself, a family member, or someone they've asked to coordinate their care.

This is a pilot. Please don't put in anything you wouldn't want kept
indefinitely by mistake, and raise any concern with whoever invited you.
`.trim();

export function PrivacyNotice() {
  const { profile, refresh } = useCircle();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (profile && profile.privacyNoticeVersion === PRIVACY_NOTICE_VERSION && profile.tosAcceptedAt) {
    return <Redirect to="/create-circle" />;
  }

  const accept = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.acceptNotice(PRIVACY_NOTICE_VERSION);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t save that — please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="ocean min-h-[100dvh] p-5 md:p-10 flex flex-col">
      <div className="mx-auto max-w-2xl w-full flex-1 flex flex-col justify-center">
        <h1 className="serif text-4xl md:text-5xl text-[#1f3740] text-center mb-6">Before you continue</h1>
        <div className="glass rounded-[28px] p-6 md:p-8 max-h-[55vh] overflow-y-auto text-sm leading-relaxed text-[#33515a] whitespace-pre-line">
          {NOTICE}
        </div>
        {err && (
          <p role="alert" className="mt-4 rounded-2xl border border-[#a23b2e]/40 bg-[#a23b2e]/10 px-4 py-3 text-sm text-[#8a2f24]">
            {err}
          </p>
        )}
        <button
          data-testid="button-accept-notice"
          onClick={() => void accept()}
          disabled={busy}
          className="mt-6 min-h-12 rounded-2xl bg-[#284c59] text-[#f7f5ed] transition hover:bg-[#1f3a44] disabled:opacity-50"
        >
          {busy ? "Saving…" : "I understand, continue"}
        </button>
      </div>
    </main>
  );
}
