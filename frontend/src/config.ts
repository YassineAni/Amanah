// Where the backend lives. Override with VITE_API_BASE at build/deploy time.
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8787";

// Supabase project — auth only on the frontend (no direct DB/Storage access;
// everything data-shaped goes through the API above). Empty-string fallback,
// not a thrown error: createClient() in supabaseClient.ts tolerates an empty
// URL/key at import time (it just can't complete any request), so a missing
// .env fails at first sign-in attempt with a clear network error instead of
// a blank white screen on every route.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";
