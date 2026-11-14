import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://payimiz:payimiz@localhost:5432/payimiz_test",
      APP_URL: "http://localhost:3000",
      APP_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
      PAYMENT_PROVIDER: "sandbox",
      PAYMENT_WEBHOOK_SECRET: "test-webhook-secret",
      RATE_LIMIT_DISABLED: "true",
      ANALYTICS_PROVIDER: "db",
      NLP_PROVIDER: "rules",
      OCR_PROVIDER: "demo",
      STORAGE_DIR: "./storage/test",
    },
  },
});
