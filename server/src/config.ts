const isTest = process.env.NODE_ENV === "test";

function required(name: string, testDefault?: string): string {
  const v = process.env[name] ?? (isTest ? testDefault : undefined);
  if (v === undefined) throw new Error(`missing required env var ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required(
    "DATABASE_URL",
    "postgresql://app_authenticated:app_authenticated@127.0.0.1:54322/postgres",
  ),
  DATABASE_URL_ADMIN: required(
    "DATABASE_URL_ADMIN",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  ),
  SUPABASE_URL: required("SUPABASE_URL", "http://127.0.0.1:54321"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key"),
  SUPABASE_JWT_SECRET: required(
    "SUPABASE_JWT_SECRET",
    "super-secret-jwt-token-with-at-least-32-characters-long",
  ),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  PORT: Number(process.env.PORT) || 8787,
  CORS_ORIGIN: process.env.CORS_ORIGIN?.trim() || "*",
  APP_ORIGIN: process.env.APP_ORIGIN?.trim() || "http://localhost:5173",
} as const;
