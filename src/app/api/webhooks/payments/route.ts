import { NextResponse } from "next/server";
import { handlePaymentWebhook } from "@/server/payments";
import { log } from "@/server/log";

/** Ödeme sağlayıcısı webhook'u. Ham gövde üzerinden imza doğrulanır; tekrar ve sıra hataları güvenle işlenir. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    const r = await handlePaymentWebhook(raw, req.headers.get("x-payimiz-signature"));
    return NextResponse.json({ result: r.result }, { status: r.status });
  } catch (e) {
    log.error("webhook_failed", e);
    return NextResponse.json({ error: "retry" }, { status: 500 }); // sağlayıcı yeniden dener; işlem idempotent
  }
}
