import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { api, type InviteInfo, ApiError } from "../api";
import { getSession } from "../session";
import { useCircle, ROLE_LABEL } from "../circle";

// /invite/:token. The common path never actually shows the "please sign in"
// state below: invites.ts sends this link via Supabase's own
// inviteUserByEmail, which completes a real Supabase session (via
// detectSessionInUrl) on the way to this page, same as a magic link. The
// fallback only matters if someone opens this link a second time after
// signing out, or forwards it — a real but rare edge case, worth handling
// simply rather than not at all.
export function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { refresh } = useCircle();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.getInvite(token)
      .then(setInfo)
      .catch((e) => setLoadErr(e instanceof ApiError ? e.message : "This invite link isn’t valid."));
  }, [token]);

  const accept = async () => {
    if (!token) return;
    setBusy(true);
    setAcceptErr(null);
    try {
      await api.acceptInvite(token);
      await refresh();
      setLocation("/"); // CircleProvider/RequireCircle route onward from here
    } catch (e) {
      setAcceptErr(e instanceof ApiError ? e.message : "Couldn’t accept this invite — please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loadErr) {
    return (
      <main className="ocean min-h-screen p-6 grid place-items-center">
        <div className="text-center">
          <p className="serif text-2xl text-[#1f3740]">{loadErr}</p>
          <p className="mt-2 text-[#54717a]">Ask whoever invited you to send a new one.</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="ocean min-h-screen p-6 grid place-items-center">
        <p className="serif text-2xl text-[#1f3740]">One moment…</p>
      </main>
    );
  }

  return (
    <main className="ocean min-h-[100dvh] p-5 md:p-10 flex flex-col">
      <div className="mx-auto max-w-md w-full flex-1 flex flex-col justify-center text-center">
        <h1 className="serif text-4xl md:text-5xl text-[#1f3740] mb-3">You’ve been invited</h1>
        <p className="text-[#54717a] mb-8">
          {info.inviterName} invited you to {info.circleName}’s circle as <b>{ROLE_LABEL[info.role]}</b>.
        </p>

        {!getSession() ? (
          <div className="glass rounded-[28px] p-6">
            <p className="text-sm text-[#33515a] mb-4">Sign in with the same email this invite was sent to, then come back to this link to accept.</p>
            <a href="/" className="inline-block min-h-11 rounded-full bg-[#284c59] px-6 py-3 text-[#f7f5ed] hover:bg-[#1f3a44]">Sign in</a>
          </div>
        ) : (
          <div className="glass rounded-[28px] p-6">
            {acceptErr && (
              <p role="alert" className="mb-4 rounded-2xl border border-[#a23b2e]/40 bg-[#a23b2e]/10 px-4 py-3 text-sm text-[#8a2f24]">
                {acceptErr}
              </p>
            )}
            <button
              data-testid="button-accept-invite"
              onClick={() => void accept()}
              disabled={busy}
              className="w-full min-h-12 rounded-2xl bg-[#284c59] text-[#f7f5ed] transition hover:bg-[#1f3a44] disabled:opacity-50"
            >
              {busy ? "Joining…" : "Accept and join"}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
