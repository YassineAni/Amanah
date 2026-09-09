import { beforeAll, expect, test } from "vitest";
import { loadFixture, type Fixture } from "./fixture";
import { asUser } from "./clients";

let fx: Fixture;
beforeAll(async () => { fx = await loadFixture(); });

test("fixture builds and a member reads their own circle", async () => {
  const rows = await asUser(fx.users.A1_coordinator, (c) =>
    c.query("select id from public.circles where id = $1", [fx.circleA1]),
  );
  expect(rows.rowCount).toBe(1);
});
