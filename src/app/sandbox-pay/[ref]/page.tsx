import { notFound } from "next/navigation";
import { q1 } from "@/server/db";
import { getPaymentProvider } from "@/server/providers/payment";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";
import { SandboxButtons } from "./buttons";

export const metadata = { title: "DEMO ödeme simülatörü", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Gerçek bir banka ya da ödeme kuruluşu sayfası DEĞİLDİR. Yalnızca PAYMENT_PROVIDER=sandbox iken çalışır. */
export default async function SandboxPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (getPaymentProvider()?.id !== "sandbox") notFound();
  const row = await q1(`select s.*, a.redirect_url, r.token_hash from sandbox_payments s left join payment_attempts a on a.provider_ref=s.ref left join payment_requests r on r.id=a.request_id where s.ref=$1`, [ref]);
  if (!row) notFound();
  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <div className="rounded-2xl border-2 border-dashed border-warm-600 bg-warm-50 p-5">
        <p className="text-xs font-extrabold uppercase tracking-widest text-warm-700">{t("sandbox.badge")}</p>
        <h1 className="mt-1 text-xl text-warm-700">{t("sandbox.title")}</h1>
        <p className="mt-2 text-sm text-warm-700">{t("sandbox.body")}</p>
        <p className="mt-5 text-3xl font-extrabold">{formatMoney(row.amount_minor, row.currency)}</p>
        <p className="muted mt-1 font-mono text-xs">{ref}</p>
        <p className="mt-3 text-sm">{t("sandbox.status")}: <b>{t(`sandbox.st_${row.status}` as "sandbox.st_initiated")}</b></p>
        <SandboxButtons providerRef={ref} status={row.status} />
      </div>
    </main>
  );
}
