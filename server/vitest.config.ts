import { defineConfig } from "vitest/config";

// DB tests share one local Postgres — run them in a single worker so the
// per-test fixture reset in fixture.ts is not racing another file.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
