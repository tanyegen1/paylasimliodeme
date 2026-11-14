import "server-only";

const e = process.env;
export const env = {
  databaseUrl: e.DATABASE_URL ?? "postgres://payimiz:payimiz@localhost:5432/payimiz_dev",
  appUrl: (e.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  appSecret: e.APP_SECRET ?? "",
  cronSecret: e.CRON_SECRET ?? "",
  demoMode: e.DEMO_MODE === "true",
  paymentProvider: (e.PAYMENT_PROVIDER ?? "none") as "none" | "sandbox",
  paymentWebhookSecret: e.PAYMENT_WEBHOOK_SECRET ?? "",
  ocrProvider: (e.OCR_PROVIDER ?? "none") as "none" | "demo" | "anthropic",
  nlpProvider: (e.NLP_PROVIDER ?? "rules") as "rules" | "anthropic",
  anthropicKey: e.ANTHROPIC_API_KEY ?? "",
  anthropicModel: e.ANTHROPIC_MODEL ?? "",
  analyticsProvider: (e.ANALYTICS_PROVIDER ?? "db") as "db" | "amplitude" | "none",
  amplitudeKey: e.AMPLITUDE_API_KEY ?? "",
  fxProvider: (e.FX_PROVIDER ?? "manual") as "manual" | "tcmb",
  storageDir: e.STORAGE_DIR ?? "./storage",
  isProd: e.NODE_ENV === "production",
};

export function requireSecret(): string {
  if (env.appSecret.length < 32) {
    if (env.isProd) throw new Error("APP_SECRET en az 32 karakter olmalı");
    return "insecure-dev-secret-do-not-use-in-production-000";
  }
  return env.appSecret;
}
