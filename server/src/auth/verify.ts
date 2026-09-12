import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import { env } from "../config.js";
import type { Claims } from "../db/pool.js";

export class TokenError extends Error {}

const secretKey = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
    );
  }
  return jwks;
}

export async function verifyAccessToken(token: string): Promise<Claims> {
  const attempts: Array<() => Promise<{ payload: Record<string, unknown> }>> = [
    () => jwtVerify(token, secretKey, { algorithms: ["HS256"] }),
    () => jwtVerify(token, getJwks(), { algorithms: ["ES256", "RS256"] }),
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      const { payload } = await attempt();
      if (typeof payload.sub !== "string" || !payload.sub) {
        throw new TokenError("token has no sub");
      }
      return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : "",
        role: typeof payload.role === "string" ? payload.role : "authenticated",
      };
    } catch (e) {
      lastErr = e;
      if (e instanceof TokenError) throw e;
      if (e instanceof errors.JWTExpired) throw new TokenError("token expired");
    }
  }
  // Details (raw jose/library text) stay server-side; the client gets a
  // generic reason, matching the deliberately-short TokenError messages
  // thrown above for the specific cases (expired / no sub).
  console.warn("token verification failed:", (lastErr as Error)?.message ?? lastErr);
  throw new TokenError("invalid token");
}
