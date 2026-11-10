import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only` throws outside Next's server bundler; tests run server code directly.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Unit tests never hit the network or real services. Live checks live in scripts/check-*.ts.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "sb_secret_test",
      OPENAI_API_KEY: "sk-test",
    },
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      // Floors for deterministic code; raised as phases add core logic (see TESTING.md).
      thresholds: { lines: 80, functions: 80, branches: 75 },
    },
  },
});
