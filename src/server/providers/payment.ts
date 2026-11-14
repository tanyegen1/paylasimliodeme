import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "../env";
import { pool } from "../db";
import { hmac, safeEqual } from "../tokens";

export type ProviderStatus = "processing" | "succeeded" | "failed" | "cancelled" | "reversed";
export type ProviderEvent = { eventId: string; providerRef: string; status: ProviderStatus; amountMinor: number; occurredAt: Date };

/**
 * Ödeme sağlayıcısı adaptörü. Gerçek entegrasyon, yetkili bir ödeme kuruluşunun
 * BELGELENMİŞ API'si ile bu arayüz uygulanarak eklenir (docs/INTEGRATIONS.md).
 * Banka şifresi, OTP, kart numarası uygulamada toplanmaz; onay sağlayıcının sayfasında yapılır.
 */
export interface PaymentProvider {
  id: string;
  isDemo: boolean;
  /** Sağlayıcının gerçekten desteklediği yöntemler. Desteklenmeyen iddia yazılmaz. */
  methods: { id: string; labelKey: string }[];
  quoteFee(amountMinor: number, currency: string): number;
  createPayment(a: { amountMinor: number; currency: string; idempotencyKey: string; returnUrl: string }): Promise<{ providerRef: string; redirectUrl: string }>;
  fetchStatus(providerRef: string): Promise<{ status: ProviderStatus | "initiated"; occurredAt: Date } | null>;
  /** İmza doğrulanamazsa null. */
  verifyWebhook(rawBody: string, signatureHeader: string | null): ProviderEvent | null;
}

const WEBHOOK_TOLERANCE_SEC = 300;
export function signWebhook(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},v1=${hmac(`${ts}.${rawBody}`, secret)}`;
}
export function verifySignature(rawBody: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const m = header.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
  if (!m) return false;
  if (Math.abs(now / 1000 - Number(m[1])) > WEBHOOK_TOLERANCE_SEC) return false;
  return safeEqual(m[2], hmac(`${m[1]}.${rawBody}`, secret));
}

/** DEMO simülatörü: uygulama içinde çalışır, gerçek banka/ödeme kuruluşu DEĞİLDİR. */
const sandbox: PaymentProvider = {
  id: "sandbox",
  isDemo: true,
  methods: [{ id: "sandbox_bank", labelKey: "pay.methodSandbox" }],
  quoteFee: () => 0,
  async createPayment({ amountMinor, currency, idempotencyKey }) {
    const ref = "sbx_" + randomBytes(12).toString("hex");
    const r = await pool.query(
      `insert into sandbox_payments (ref, amount_minor, currency, idempotency_key) values ($1,$2,$3,$4)
       on conflict (idempotency_key) do update set updated_at = sandbox_payments.updated_at returning ref`, [ref, amountMinor, currency, idempotencyKey]);
    const providerRef = r.rows[0].ref as string;
    return { providerRef, redirectUrl: `${env.appUrl}/sandbox-pay/${providerRef}` };
  },
  async fetchStatus(providerRef) {
    const r = await pool.query(`select status, updated_at from sandbox_payments where ref=$1`, [providerRef]);
    return r.rows[0] ? { status: r.rows[0].status, occurredAt: r.rows[0].updated_at } : null;
  },
  verifyWebhook(rawBody, header) {
    if (!verifySignature(rawBody, header, env.paymentWebhookSecret)) return null;
    try {
      const b = JSON.parse(rawBody);
      const status = String(b.type ?? "").replace("payment.", "") as ProviderStatus;
      if (!["processing", "succeeded", "failed", "cancelled", "reversed"].includes(status)) return null;
      if (typeof b.id !== "string" || typeof b.ref !== "string" || !Number.isSafeInteger(b.amount_minor)) return null;
      const occurredAt = new Date(b.occurred_at);
      if (Number.isNaN(occurredAt.getTime())) return null;
      return { eventId: b.id, providerRef: b.ref, status, amountMinor: b.amount_minor, occurredAt };
    } catch {
      return null;
    }
  },
};

/** Etkin sağlayıcı. `none` ise null döner: yalnızca IBAN + bildirim + alıcı onayı akışı sunulur. */
export function getPaymentProvider(): PaymentProvider | null {
  if (env.paymentProvider === "sandbox") {
    // Demo simülatörü üretimde yalnızca DEMO_MODE açıkken çalışır.
    if (env.isProd && !env.demoMode) return null;
    if (!env.paymentWebhookSecret) return null;
    return sandbox;
  }
  return null;
}
