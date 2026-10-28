import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root.replace(/\/$/, ""),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      APP_TIMEZONE: "Asia/Shanghai",
      SESSION_SECRET: "vitest-session-secret-for-factory-issue-tracker",
    },
    include: ["tests/**/*.test.ts"],
  },
});
