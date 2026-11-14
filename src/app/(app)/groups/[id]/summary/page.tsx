import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { computeGroupBalances } from "@/server/ledger";
import { periodSummary } from "@/server/activity";
import { planInGroup } from "@/server/entitlements";
import { PLANS } from "@/config/plans";
import { Header, Notice, Page } from "@/components/ui";
import { ShareRow } from "@/components/client";
import { CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { t, tDyn } from "@/lib/i18n";
import { PrintButton } from "./print";

export const metadata = { title: "Özet" };

export default async function SummaryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  const monthly = ctx.group.type === "home";
  const today = todayISO(user.timezone);
  const month = monthly ? (/^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : today.slice(0, 7)) : null;
  const from = month ? `${month}-01` : null;
  const to = month ? `${month}-${String(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}` : null;
  const [s, b, plan] = await Promise.all([periodSummary(id, user.id, from, to), computeGroupBalances(id), planInGroup(user.id, id)]);
  const name = (m: string) => ctx.members.find((x) => x.id === m)?.display_name ?? "?";
  const totals: Record<string, number> = {};
  for (const c of s.byCategory) totals[c.currency] = (totals[c.currency] ?? 0) + c.total;
  const monthLabel = (m: string) => new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-01T00:00:00Z"));
  const months = [...new Set([today.slice(0, 7), ...s.byMonth.map((x) => x.month)])].sort().reverse();
  const shareText = [
    t("summary.shareHead", { group: ctx.group.name, period: month ? monthLabel(month) : ctx.group.start_date && ctx.group.end_date ? `${formatDate(ctx.group.start_date)} – ${formatDate(ctx.group.end_date)}` : "" }).trim(),
    ...Object.entries(totals).map(([c, v]) => t("summary.shareTotal", { amount: formatMoney(v, c) })),
    ...(b.transfers.length ? b.transfers.map((x) => t("summary.shareLine", { from: name(x.from), to: name(x.to), amount: formatMoney(x.amount, x.currency) })) : [t("balance.settledLong")]),
  ].join("\n");
  const max = Math.max(1, ...s.byMonth.map((x) => x.total));
  return (
    <Page>
      <Header title={monthly ? t("summary.monthly") : t("summary.title")} back={`/groups/${id}`} subtitle={ctx.group.name} />
      {monthly && (
        <nav aria-label={t("summary.months")} className="no-print -mx-4 mb-4 overflow-x-auto px-4"><ul className="flex min-w-max gap-1.5">
          {months.map((m) => <li key={m}><Link href={`/groups/${id}/summary?m=${m}`} className={`chip ${m === month ? "chip-on" : ""}`}>{monthLabel(m)}</Link></li>)}
        </ul></nav>
      )}
      <section className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">{t("summary.total")}{month ? ` · ${monthLabel(month)}` : ""}</p>
        {Object.keys(totals).length === 0 ? <p className="mt-1 text-xl font-bold text-ink-mute">{formatMoney(0, ctx.group.currency)}</p> : Object.entries(totals).map(([c, v]) => <p key={c} className="mt-1 text-2xl font-extrabold">{formatMoney(v, c)}</p>)}
      </section>
      {s.byCategory.length > 0 && (
        <>
          <h2 className="section-title">{t("summary.byCategory")}</h2>
          <ul className="card grid gap-2 text-sm">{s.byCategory.map((c, i) => <li key={i} className="row"><span><span aria-hidden>{CATEGORY_EMOJI[c.category as Category] ?? "🧾"}</span> {tDyn(`category.${c.category}`, c.category)} <span className="muted">· {c.n}</span></span><b>{formatMoney(c.total, c.currency)}</b></li>)}</ul>
          <h2 className="section-title">{t("summary.byMember")}</h2>
          <div className="card overflow-x-auto p-0"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-mute"><th className="px-4 py-2 font-semibold">{t("summary.person")}</th><th className="px-2 py-2 text-right font-semibold">{t("summary.paid")}</th><th className="px-4 py-2 text-right font-semibold">{t("summary.share")}</th></tr></thead>
            <tbody>{s.byMember.map((r, i) => <tr key={i} className="border-t border-paper-line"><td className="px-4 py-2">{name(r.member_id)}</td><td className="px-2 py-2 text-right">{formatMoney(r.paid, r.currency)}</td><td className="px-4 py-2 text-right font-semibold">{formatMoney(r.share, r.currency)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
      <h2 className="section-title">{t("summary.settle")}</h2>
      {b.transfers.length === 0 ? <Notice tone="ok">{t("balance.settledLong")}</Notice> : (
        <ul className="card grid gap-2 text-sm">{b.transfers.map((x, i) => <li key={i} className="row"><span><b>{name(x.from)}</b> → <b>{name(x.to)}</b></span><b>{formatMoney(x.amount, x.currency)}</b></li>)}</ul>
      )}
      <p className="muted mt-2 text-xs">{t("summary.settleNote")}</p>

      <div className="no-print mt-5 grid gap-3">
        <ShareRow text={shareText} />
        <h2 className="section-title !mb-0">{t("summary.advanced")}</h2>
        {PLANS[plan].advancedReports ? (
          s.byMonth.length > 0 && (
            <ul className="card grid gap-2 text-sm">{s.byMonth.slice(0, 12).map((x, i) => (
              <li key={i}><div className="row"><span>{monthLabel(x.month)}</span><b>{formatMoney(x.total, x.currency)}</b></div><div className="mt-1 h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(3, Math.round((x.total / max) * 100))}%` }} /></div></li>
            ))}</ul>
          )
        ) : <Notice>{t("summary.premiumOnly")} <Link href="/premium" className="font-semibold underline">{t("premium.learn")}</Link></Notice>}
        {PLANS[plan].export && (
          <div className="grid grid-cols-2 gap-2">
            <a className="btn-secondary" href={`/api/export/${id}${month ? `?m=${month}` : ""}`}>{t("summary.csv")}</a>
            <PrintButton label={t("summary.pdf")} />
          </div>
        )}
      </div>
    </Page>
  );
}
