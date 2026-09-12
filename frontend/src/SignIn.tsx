import { useState, type FormEvent } from "react";
import { Redirect } from "wouter";
import { supabase } from "./supabaseClient";
import { getSession } from "./session";
import { homeFor, useCircle } from "./circle";

// Replaces the old persona-chip + username/password screen — magic-link
// only (Q1, confirmed: no dev-persona shortcut). A real family signing in
// for the pilot has an email, not a demo username.
export function SignIn() {
  const session = getSession();
  const { loading, activeCircle } = useCircle();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Already signed in: route onward rather than showing the sign-in form.
  // Mirrors RequireCircle's own redirects (circle.tsx) so a signed-in user
  // landing on "/" doesn't just sit on the sign-in screen.
  if (session) {
    if (loading) return null;
    return <Redirect to={activeCircle ? homeFor(activeCircle.role) : "/create-circle"} />;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <main className="ocean min-h-[100dvh] p-5 md:p-10 flex flex-col">
      <div className="mx-auto flex-1 flex flex-col justify-center max-w-md w-full">
        <div className="text-center mb-10 mt-8">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/80 bg-white/45 font-semibold text-2xl shadow-sm mb-6 text-[#1f3740]">A</div>
          <h1 className="serif text-5xl md:text-6xl text-[#1f3740]">Amanah</h1>
          <p className="mt-4 text-lg text-[#42616a]">Sign in to your care circle.</p>
        </div>

        {sent ? (
          <div className="glass rounded-[28px] p-6 text-center space-y-3">
            <p className="text-lg text-[#1f3740]">Check your email.</p>
            <p className="text-sm text-[#54717a]">
              We sent a sign-in link to <b>{email.trim()}</b>. Open it on this device to continue.
            </p>
            <button
              type="button"
              onClick={() => { setSent(false); setErr(null); }}
              className="mt-2 text-sm text-[#284c59] underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="glass rounded-[28px] p-6 space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-[#1f3740] block mb-1.5">Email</span>
              <input
                data-testid="input-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErr(null); }}
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full min-h-12 rounded-2xl border border-[#789a9b]/50 bg-white/60 px-4 text-[#1f3740] outline-none focus:border-[#284c59]"
              />
            </label>
            {err && (
              <p role="alert" className="rounded-2xl border border-[#a23b2e]/40 bg-[#a23b2e]/10 px-4 py-3 text-sm text-[#8a2f24]">
                {err}
              </p>
            )}
            <button
              data-testid="button-signin"
              type="submit"
              disabled={busy || !email.trim()}
              className="w-full min-h-12 rounded-2xl bg-[#284c59] text-[#f7f5ed] transition hover:bg-[#1f3a44] disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send me a link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
