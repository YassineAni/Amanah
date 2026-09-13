// Where the backend lives. Override with VITE_API_BASE at build/deploy time.
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8787";

// Supabase project — auth only on the frontend (no direct DB/Storage access;
// everything data-shaped goes through the API above).
//
// The fallback here is a placeholder, syntactically-valid URL, NOT an empty
// string. Verified directly (node -e against the installed
// @supabase/supabase-js): createClient("", "", ...) throws synchronously
// ("supabaseUrl is required.") — and supabaseClient.ts calls createClient at
// MODULE SCOPE, so an empty string here doesn't degrade to "a clear network
// error at first sign-in attempt," it crashes the entire bundle at import
// time — a blank white screen on every single route, including ones that
// never touch auth. A placeholder URL lets the client construct
// successfully; a real sign-in attempt against it then fails with a normal,
// visible network/DNS error instead.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "https://missing-supabase-url.invalid";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "missing-anon-key";
