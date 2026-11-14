import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { computeGroupBalances, explainMember } from "@/server/ledger";
import { BalanceText, Header, Notice, Page, Badge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatShortDate, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata = { title: "Bakiye açıklaması" };

/** Bir bakiyenin tam dökümü: hangi harcamadan ne kadar, hangi ödemeyle ne kadar. */
export default async function BalanceExplainPage({ params }: { params: Promise<{ id: string; mid: string }> }) {
  const { id, mid } = await params;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  const member = ctx.members.find((m) => m.id === mid);
  if (!member) notFound();
  const [b, x] = await Promise.all([computeGroupBalances(id), explainMember(id, user.id, mid)]);
  const mine = mid === ctx.me.id;
  const name = (m: string) => ctx.members.find((y) => y.id === m)?.display_name ?? "?";
  return (
    <Page>
      <Header title={mine ? t("explain.titleMine") : t("explain.title", { name: member.display_name })} back={`/groups/${id}?tab=balances`} subtitle={ctx.group.name} />
      <section className="card">
        {b.currencies.length === 0 && <p className="font-semibold">{t("balance.settledLong")}</p>}
        {b.currencies.map((c) => <p key={c} className="text-xl"><BalanceText net={b.nets[c][mid] ?? 0} currency={c} mine={mine} /></p>)}
        <p className="muted mt-2 text-xs">{t("explain.formula")}</p>
      </section>
      <h2 className="section-title">{t("explain.expenses")}</h2>
      {x.expenses.length === 0 ? <Notice>{t("explain.none")}</Notice> : (
        <ul className="card divide-y divide-paper-line p-0">
          {x.expenses.map((e) => (
            <li key={e.id}><Link href={`/groups/${id}/expenses/${e.id}`} className="grid gap-0.5 px-4 py-3 text-sm">
              <span className="row"><span className="truncate font-semibold">{e.title}</span><span className={`font-bold ${e.paid - e.share >= 0 ? "text-brand-700" : "text-warm-700"}`}>{formatMoney(e.paid - e.share, e.currency, { sign: true })}</span></span>
              <span className="muted text-xs">{formatShortDate(e.expense_date)} · {t("explain.line", { paid: formatMoney(e.paid, e.currency), share: formatMoney(e.share, e.currency) })}</span>
            </Link></li>
          ))}
        </ul>
      )}
      {x.payments.length > 0 && (
        <>
          <h2 className="section-title">{t("explain.payments")}</h2>
          <ul className="card divide-y divide-paper-line p-0">
            {x.payments.map((p) => {
              const out = p.from_member === mid;
              return (
                <li key={p.id} className="grid gap-0.5 px-4 py-3 text-sm">
                  <span className="row"><span>{out ? t("explain.paidTo", { name: name(p.to_member) }) : t("explain.receivedFrom", { name: name(p.from_member) })}</span><span className={`font-bold ${out ? "text-brand-700" : "text-warm-700"}`}>{formatMoney(out ? p.amount_minor : -p.amount_minor, p.currency, { sign: true })}</span></span>
                  <span className="flex items-center gap-2"><Badge tone={p.source === "provider" ? "ok" : "info"}>{p.source === "provider" ? t("payLabel.providerVerified") : t("payLabel.recipientConfirmed")}</Badge><span className="muted text-xs">{formatDateTime(p.created_at)}</span></span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Page>
  );
}
