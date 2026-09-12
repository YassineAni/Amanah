import { beforeAll, describe, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture.js";
import { asUser } from "./clients.js";

// HANDOFF.md NEW-1 (carried from 1a's final review): upd_profiles has no
// column scope without this trigger — a user could rewrite their own
// email/full_name/created_at. Regression guard for migration
// 20260911000001_profiles_column_scope.sql.
let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

describe("profiles_column_scope", () => {
  test("a user cannot rewrite their own email", async () => {
    await expect(
      asUser(fx.users.A1_coordinator, (c) =>
        c.query(`update public.profiles set email = 'spoofed@example.com' where id = $1`,
          [fx.users.A1_coordinator]),
      ),
    ).rejects.toThrow(/only ui_lang/i);
  });

  test("a user cannot rewrite their own full_name", async () => {
    await expect(
      asUser(fx.users.A1_coordinator, (c) =>
        c.query(`update public.profiles set full_name = 'Someone Else' where id = $1`,
          [fx.users.A1_coordinator]),
      ),
    ).rejects.toThrow(/only ui_lang/i);
  });

  test("a user cannot rewrite their own created_at", async () => {
    await expect(
      asUser(fx.users.A1_coordinator, (c) =>
        c.query(`update public.profiles set created_at = '2000-01-01' where id = $1`,
          [fx.users.A1_coordinator]),
      ),
    ).rejects.toThrow(/only ui_lang/i);
  });

  test("a user CAN change ui_lang, tos_accepted_at, privacy_notice_version together", async () => {
    const r = await asUser(fx.users.A1_coordinator, (c) =>
      c.query(
        `update public.profiles
         set ui_lang = 'fr', tos_accepted_at = now(), privacy_notice_version = 'v2'
         where id = $1 returning ui_lang, privacy_notice_version`,
        [fx.users.A1_coordinator],
      ),
    );
    expect(r.rows[0].ui_lang).toBe("fr");
    expect(r.rows[0].privacy_notice_version).toBe("v2");
  });
});
