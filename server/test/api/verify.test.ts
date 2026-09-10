import { describe, expect, test } from "vitest";
import { SignJWT } from "jose";
import { verifyAccessToken, TokenError } from "../../src/auth/verify.js";

const secret = new TextEncoder().encode(
  "super-secret-jwt-token-with-at-least-32-characters-long",
);
const mint = (over: Record<string, unknown>, expSecondsFromNow = 3600) =>
  new SignJWT({ role: "authenticated", email: "u@example.com", ...over })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(secret);

describe("verifyAccessToken", () => {
  test("accepts a fresh HS256 token and returns claims", async () => {
    const t = await mint({ sub: "abc" });
    const c = await verifyAccessToken(t);
    expect(c.sub).toBe("abc");
    expect(c.email).toBe("u@example.com");
  });
  test("rejects an expired token", async () => {
    const t = await mint({ sub: "abc" }, -10);
    await expect(verifyAccessToken(t)).rejects.toBeInstanceOf(TokenError);
  });
  test("rejects a token with no sub", async () => {
    const t = await mint({});
    await expect(verifyAccessToken(t)).rejects.toBeInstanceOf(TokenError);
  });
  test("rejects garbage", async () => {
    await expect(verifyAccessToken("not.a.jwt")).rejects.toBeInstanceOf(TokenError);
  });
});
