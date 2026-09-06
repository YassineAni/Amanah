// Where the backend lives. Override with VITE_API_BASE at build/deploy time.
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ||
  "http://localhost:8787";
