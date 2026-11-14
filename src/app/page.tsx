import Link from "next/link";
import { ArrowRight, Bell, ChevronRight, Link2, ReceiptText, Scale } from "lucide-react";
import { getUser } from "@/server/session";
import { getHomeSummary } from "@/server/ledger";
import { listNotifications, unreadCount, userActivity } from "@/server/activity";
import { q } from "@/server/db";
import { BottomNav } from "@/components/nav";
import { BalanceText, Empty, Page, Badge } from "@/components/ui";
import { ActivityList } from "@/components/activity";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";
import { firstName } from "@/lib/format";
import { GROUP_EMOJI } from "@/lib/group-types";

export default async function HomePage() {
  const user = await getUser();
  if (!user) return <Landing />;
  const [{ groups, totals, perGroup }, activity, unread, pending] = await Promise.all([
    getHomeSummary(user.id), userActivity(user.id, 6), unreadCount(user.id), pendingForUser(user.id),
  ]);
  const active = groups.filter((g) => !g.archived_at);
  const currencies = Object.keys(totals);
  return (
    <>
      <Page>
        <header className="row mb-5">
          <div>
            <p className="muted">{t("home.hello", { name: firstName(user.display_name) })}</p>
            <h1>{brand.name}</h1>
          </div>
          <Link href="/activity" aria-label={t("home.notifications")} className="relative grid h-11 w-11 place-items-center rounded-full border border-paper-line bg-white">
            <Bell aria-hidden className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-warm-600" />}
          </Link>
        </header>

        {user.is_guest && (
          <Link href="/profile#secure" className="mb-4 flex items-center gap-3 rounded-2xl border border-brand-600/25 bg-brand-50 px-4 py-3 text-sm text-brand-800">
            <span className="flex-1"><b>{t("home.secureTitle")}</b> {t("home.secureBody")}</span>
            <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
          </Link>
        )}

        <section aria-label={t("home.totals")} className="grid grid-cols-2 gap-3">
          <div className="card">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">{t("home.owedToYou")}</p>
            {currencies.filter((c) => totals[c].owed > 0).map((c) => <p key={c} className="mt-1 text-xl font-bold text-brand-700">{formatMoney(totals[c].owed, c)}</p>)}
            {!currencies.some((c) => totals[c].owed > 0) && <p className="mt-1 text-xl font-bold text-ink-mute">{formatMoney(0)}</p>}
          </div>
          <div className="card">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">{t("home.youOwe")}</p>
            {currencies.filter((c) => totals[c].owe > 0).map((c) => <p key={c} className="mt-1 text-xl font-bold text-warm-700">{formatMoney(totals[c].owe, c)}</p>)}
            {!currencies.some((c) => totals[c].owe > 0) && <p className="mt-1 text-xl font-bold text-ink-mute">{formatMoney(0)}</p>}
          </div>
        </section>
        {currencies.length > 1 && <p className="muted mt-2 text-xs">{t("home.multiCurrency")}</p>}

        {pending.length > 0 && (
          <>
            <h2 className="section-title">{t("home.pending")}</h2>
            <ul className="grid gap-2">
              {pending.map((p) => (
                <li key={p.key}>
                  <Link href={p.href} className="card flex items-center gap-3 py-3">
                    <span className="flex-1 text-sm">
                      <span className="font-semibold">{p.title}</span>
                      <span className="muted block">{p.group}</span>
                    </span>
                    <Badge tone={p.tone}>{p.badge}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mb-2 mt-6 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t("home.groups")}</h2>
          <Link href="/groups/new" className="text-sm font-semibold text-brand-700">{t("home.newGroup")}</Link>
        </div>
        {active.length === 0 ? (
          <Empty icon="👋" title={t("home.emptyTitle")} body={t("home.emptyBody")}>
            <Link href="/groups/new" className="btn-primary">{t("home.createFirst")}</Link>
          </Empty>
        ) : (
          <ul className="grid gap-2">
            {active.slice(0, 4).map((g) => {
              const nets = Object.entries(perGroup[g.id] ?? {});
              return (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="card flex items-center gap-3 py-3">
                    <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-xl">{GROUP_EMOJI[g.type]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{g.name}</span>
                      <span className="block text-sm">
                        {nets.length === 0 ? <span className="text-ink-mute">{t("balance.settled")}</span> : nets.map(([c, v]) => <BalanceText key={c} net={v} currency={c} className="mr-2" />)}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="h-5 w-5 text-ink-mute" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {activity.length > 0 && (
          <>
            <div className="mb-2 mt-6 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t("home.recent")}</h2>
              <Link href="/activity" className="text-sm font-semibold text-brand-700">{t("common.all")}</Link>
            </div>
            <ActivityList rows={activity} showGroup />
          </>
        )}
      </Page>
      <BottomNav unread={unread} addHref="/add" />
    </>
  );
}

/** Kullanıcıdan işlem bekleyen kalemler: onaylayacağı beyanlar, ödeyeceği talepler, sahiplenme talepleri. */
async function pendingForUser(userId: string) {
  const out: { key: string; title: string; group: string; href: string; badge: string; tone: "warn" | "info" }[] = [];
  const reports = await q(
    `select r.id, r.group_id, r.amount_minor, r.currency, g.name as group_name, f.display_name as from_name
     from manual_payment_reports r join members tm on tm.id=r.to_member join members f on f.id=r.from_member join groups g on g.id=r.group_id
     where r.status='reported' and tm.user_id=$1 and tm.status='active' order by r.created_at desc limit 5`, [userId]);
  for (const r of reports) out.push({ key: r.id, title: t("home.pendingConfirm", { name: r.from_name, amount: formatMoney(r.amount_minor, r.currency) }), group: r.group_name, href: `/groups/${r.group_id}?tab=payments`, badge: t("home.badgeConfirm"), tone: "warn" });
  const reqs = await q(
    `select r.id, r.group_id, r.amount_minor, r.currency, g.name as group_name, tm.display_name as to_name
     from payment_requests r join members fm on fm.id=r.from_member join members tm on tm.id=r.to_member join groups g on g.id=r.group_id
     where r.status in ('pending','failed') and r.expires_at > now() and fm.user_id=$1 and fm.status='active' order by r.created_at desc limit 5`, [userId]);
  for (const r of reqs) out.push({ key: r.id, title: t("home.pendingPay", { name: r.to_name, amount: formatMoney(r.amount_minor, r.currency) }), group: r.group_name, href: `/groups/${r.group_id}?tab=payments`, badge: t("home.badgePay"), tone: "info" });
  const claims = await q(
    `select c.id, c.group_id, g.name as group_name, u.display_name from claim_requests c join groups g on g.id=c.group_id join users u on u.id=c.user_id
     join members me on me.group_id=c.group_id and me.user_id=$1 and me.role='admin' and me.status='active' where c.status='pending' limit 5`, [userId]);
  for (const c of claims) out.push({ key: c.id, title: t("home.pendingClaim", { name: c.display_name }), group: c.group_name, href: `/groups/${c.group_id}?tab=members`, badge: t("home.badgeApprove"), tone: "warn" });
  return out;
}

function Landing() {
  const steps = [
    { icon: Link2, title: t("landing.s1t"), body: t("landing.s1b") },
    { icon: ReceiptText, title: t("landing.s2t"), body: t("landing.s2b") },
    { icon: Scale, title: t("landing.s3t"), body: t("landing.s3b") },
  ];
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-10 pt-10">
      <p className="text-lg font-extrabold tracking-tight text-brand-700">{brand.name}</p>
      <h1 className="mt-8 text-[2.1rem] font-extrabold leading-[1.1]">{t("landing.h1a")}<br /><span className="text-brand-600">{t("landing.h1b")}</span></h1>
      <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">{t("landing.lead")}</p>
      <div className="mt-7 grid gap-2.5">
        <Link href="/login?mode=start&next=/groups/new" className="btn-primary min-h-[54px] text-base">{t("landing.cta")} <ArrowRight aria-hidden className="h-5 w-5" /></Link>
        <Link href="/login" className="btn-secondary">{t("landing.login")}</Link>
      </div>
      <ol className="mt-10 grid gap-3">
        {steps.map((s, i) => (
          <li key={i} className="card flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700"><s.icon aria-hidden className="h-5 w-5" /></span>
            <div><p className="font-semibold">{s.title}</p><p className="muted">{s.body}</p></div>
          </li>
        ))}
      </ol>
      <footer className="muted mt-auto pt-10 text-xs">
        <p>{t("landing.honest")}</p>
        <p className="mt-2 flex gap-3"><Link className="underline" href="/legal/privacy">{t("legal.privacy")}</Link><Link className="underline" href="/legal/terms">{t("legal.terms")}</Link><Link className="underline" href="/legal/kvkk">{t("legal.kvkk")}</Link></p>
      </footer>
    </main>
  );
}
