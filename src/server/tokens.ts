import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireSecret } from "./env";

/** 256 bit rastgele, URL'e uygun belirteç. Veritabanında yalnızca SHA-256 özeti saklanır. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export const hmac = (data: string, secret = requireSecret()) => createHmac("sha256", secret).update(data).digest("hex");
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Analitik için geri döndürülemez takma kimlik. */
export const pseudonym = (id: string) => hmac("analytics:" + id).slice(0, 24);

/** Süreli dosya bağlantısı imzası. */
export function signFile(attachmentId: string, expiresAt: number) {
  return hmac(`file:${attachmentId}:${expiresAt}`);
}
