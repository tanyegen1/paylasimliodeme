import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { getPayLink, syncOpenAttemptsForToken } from "@/server/payments";
import { getUser } from "@/server/session";
import { brand } from "@/config/brand";
import { Avatar, Celebrate, Notice } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate, formatShortDate, firstName } from "@/lib/format";
import { t } from "@/lib/i18n";
import { PayClient } from "./pay";

export const metadata = { title: "Ödeme", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Sonuç, tarayıcının dönüş adresine göre değil sunucudan sağlayıcıya sorularak belirlenir.
  await syncOpenAttemptsForToken(token).catch(() => {});
  const link = await getPayLink(token);
  const user = await getUser();
  return (
    <main className="rise mx-auto max-w-xl px-5 pb-16 pt-8">
      <Wordmark href={null} />
      {!link ? (
        <div className="card mt-8 text-center"><p aria-hidden className="text-4xl">🔗</p><h1 className="mt-2 text-xl">{t("pay.invalid")}</h1><p className="muted mt-2">{t("pay.invalidBody")}</p></div>
      ) : (
        <>
          <section className="hero mt-6">
            {link.status === "verified" && <Celebrate />}
            <div className="row"><p className="text-sm font-bold text-white/80">{link.groupName}</p><span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">{t(`requestStatus.${link.status}`)}</span></div>
            <div className="mt-5 flex items-center gap-3"><Avatar name={link.toName} size="lg" ring /><p className="text-[15px] font-semibold leading-snug text-white/90">{t("pay.toLine", { from: firstName(link.fromName), to: link.toName })}</p></div>
            <p className="mt-3 text-[2.6rem] font-extrabold leading-none tracking-tight">{formatMoney(link.remaining || link.amount, link.currency)}</p>
            {link.paid > 0 && link.remaining > 0 && <p className="mt-2 text-sm text-white/80">{t("pay.partial", { paid: formatMoney(link.paid, link.currency), total: formatMoney(link.amount, link.currency) })}</p>}
            {link.note && <p className="hero-glass mt-4 px-3 py-2 text-sm">“{link.note}”</p>}
            <p className="mt-4 text-xs text-white/65">{t("pay.expires", { date: formatDate(link.expiresAt) })}</p>
          </section>

          {link.expenses.length > 0 && (
            <details className="card mt-3" open={link.expenses.length <= 4}>
              <summary className="cursor-pointer text-sm font-semibold">{t("pay.why")}</summary>
              <ul className="mt-3 grid gap-1.5 text-sm">{link.expenses.map((e, i) => <li key={i} className="row"><span className="truncate">{e.title} <span className="muted">· {formatShortDate(e.expense_date)}</span></span><b>{formatMoney(e.share, e.currency)}</b></li>)}</ul>
              <p className="muted mt-2 text-xs">{t("pay.whyNote")}</p>
            </details>
          )}

          <div className="mt-4">
            {link.status === "verified" ? <Notice tone="ok" title={t("pay.doneTitle")}>{t("pay.doneBody", { to: firstName(link.toName) })}</Notice>
              : link.status === "expired" ? <Notice tone="warn" title={t("pay.expiredTitle")}>{t("pay.expiredBody", { to: firstName(link.toName) })}</Notice>
              : link.status === "processing" ? <Notice tone="warn" title={t("pay.processingTitle")}>{t("pay.processingBody")}<Link href={`/pay/${token}`} className="mt-2 block font-semibold underline">{t("pay.refresh")}</Link></Notice>
              : <PayClient token={token} currency={link.currency} remaining={link.remaining} reported={link.reported} toName={link.toName} hasIban={link.hasIban} failed={link.status === "failed"}
                  provider={link.provider} proposedDate={link.proposedDate} proposalStatus={link.proposalStatus} />}
          </div>
          {user && <Link href={`/groups/${link.groupId}`} className="btn-ghost mt-4 w-full">{t("pay.openGroup")}</Link>}
          <p className="muted mt-6 text-xs">{t("pay.scopeNote")}</p>
        </>
      )}
    </main>
  );
}
