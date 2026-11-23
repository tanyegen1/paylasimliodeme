import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { ThemeButton } from "@/components/theme-picker";
import { ArrowRight, Bell, ChevronRight, Link2, Plus, ReceiptText, Scale } from "lucide-react";
import { getUser } from "@/server/session";
import { getHomeSummary } from "@/server/ledger";
import { listNotifications, unreadCount, userActivity } from "@/server/activity";
import { q } from "@/server/db";
import { BottomNav } from "@/components/nav";
import { Avatar, Celebrate, Page } from "@/components/ui";
import { ActivityList } from "@/components/activity";
import { GroupCard } from "@/components/group-card";
import { brand } from "@/config/brand";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";
import { firstName } from "@/lib/format";


export default async function HomePage() {
  const user = await getUser();
  if (!user) return <Landing />;
  const [{ groups, totals, perGroup }, activity, unread, pending] = await Promise.all([
    getHomeSummary(user.id), userActivity(user.id, 5), unreadCount(user.id), pendingForUser(user.id),
  ]);
  const active = groups.filter((g) => !g.archived_at);
  const currencies = Object.keys(totals);
  const owed = currencies.filter((c) => totals[c].owed > 0);
  const owe = currencies.filter((c) => totals[c].owe > 0);
  const allSettled = owed.length === 0 && owe.length === 0;
  return (
    <>
      <Page>
        <header className="row mb-5">
          <div>
            <Wordmark height={26} className="mb-4" />
            <p className="text-[15px] font-semibold text-ink-mute">{t("home.hello", { name: firstName(user.display_name) })} 👋</p>
            <h1 className="mt-0.5">{active.length ? t("home.headline") : t("home.headlineNew")}</h1>
          </div>
          <Link href="/activity" aria-label={t("home.notifications")} className="relative grid h-12 w-12 self-start place-items-center rounded-full bg-paper-card shadow-card ring-1 ring-paper-line transition active:scale-95">
            <Bell aria-hidden className="h-5 w-5" />
            {unread > 0 && <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-warm-600 ring-2 ring-paper-card" />}
          </Link>
        </header>

        {active.length === 0 ? (
          <section className="hero">
            <p aria-hidden className="text-5xl">🧾✨</p>
            <h2 className="mt-4 text-2xl font-extrabold text-white">{t("home.emptyTitle")}</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/80">{t("home.emptyBody")}</p>
            <Link href="/groups/new" className="btn mt-5 w-full bg-paper-card text-brand-800 hover:bg-brand-50">{t("home.createFirst")} <ArrowRight aria-hidden className="h-5 w-5" /></Link>
          </section>
        ) : (
          <section aria-label={t("home.totals")} className="hero">
            {allSettled && <Celebrate />}
            <p className="text-[13px] font-bold uppercase tracking-wider text-white/70">{t("home.totals")}</p>
            {allSettled ? (
              <p className="mt-2 text-2xl font-extrabold">{t("home.allSettled")}</p>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div className="hero-glass p-3.5">
                  <p className="text-[12px] font-bold text-white/85">{t("home.owedToYou")}</p>
                  {(owed.length ? owed : [currencies[0] ?? "TRY"]).map((c) => <p key={c} className="mt-0.5 text-[1.35rem] font-extrabold leading-tight">{formatMoney(totals[c]?.owed ?? 0, c)}</p>)}
                </div>
                <div className="hero-glass p-3.5">
                  <p className="text-[12px] font-bold text-warm-200">{t("home.youOwe")}</p>
                  {(owe.length ? owe : [currencies[0] ?? "TRY"]).map((c) => <p key={c} className="mt-0.5 text-[1.35rem] font-extrabold leading-tight">{formatMoney(totals[c]?.owe ?? 0, c)}</p>)}
                </div>
              </div>
            )}
            {currencies.length > 1 && <p className="mt-3 text-xs text-white/70">{t("home.multiCurrency")}</p>}
          </section>
        )}

        {pending.length > 0 && (
          <>
            <h2 className="section-title">{t("home.pending")}</h2>
            <ul className="grid gap-2.5">
              {pending.map((p) => (
                <li key={p.key}>
                  <Link href={p.href} className="card flex items-center gap-3 !p-4 transition active:scale-[0.99]">
                    <Avatar name={p.person} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold leading-snug">{p.title}</span>
                      <span className="muted block truncate">{p.group}</span>
                    </span>
                    <span className={`badge px-3 py-1.5 text-[13px] ${p.tone === "warn" ? "bg-warm-50 text-warm-700" : "bg-brand-600 text-white"}`}>{p.badge}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {active.length > 0 && (
          <>
            <div className="mb-3 mt-7 flex items-center justify-between">
              <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-ink-mute">{t("home.groups")}</h2>
              <Link href="/groups/new" className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700"><Plus aria-hidden className="h-4 w-4" />{t("home.newGroup")}</Link>
            </div>
            <ul className="grid gap-2.5">
              {active.slice(0, 5).map((g) => (
                <li key={g.id}><GroupCard g={g} nets={perGroup[g.id] ?? {}} /></li>
              ))}
            </ul>
          </>
        )}

        {user.is_guest && active.length > 0 && (
          <Link href="/profile#secure" className="mt-5 flex items-center gap-3 rounded-2xl bg-paper-card px-4 py-3.5 text-sm shadow-card ring-1 ring-paper-line">
            <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-brand-50 text-lg">🔐</span>
            <span className="flex-1"><b>{t("home.secureTitle")}</b> <span className="text-ink-mute">{t("home.secureBody")}</span></span>
            <ChevronRight aria-hidden className="h-5 w-5 text-ink-faint" />
          </Link>
        )}

        {activity.length > 0 && (
          <>
            <div className="mb-3 mt-7 flex items-center justify-between">
              <h2 className="text-[13px] font-extrabold uppercase tracking-wider text-ink-mute">{t("home.recent")}</h2>
              <Link href="/activity" className="text-sm font-bold text-brand-700">{t("common.all")}</Link>
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
  const out: { key: string; person: string; title: string; group: string; href: string; badge: string; tone: "warn" | "info" }[] = [];
  const reports = await q(
    `select r.id, r.group_id, r.amount_minor, r.currency, g.name as group_name, f.display_name as from_name
     from manual_payment_reports r join members tm on tm.id=r.to_member join members f on f.id=r.from_member join groups g on g.id=r.group_id
     where r.status='reported' and tm.user_id=$1 and tm.status='active' order by r.created_at desc limit 5`, [userId]);
  for (const r of reports) out.push({ key: r.id, person: r.from_name, title: t("home.pendingConfirm", { name: r.from_name, amount: formatMoney(r.amount_minor, r.currency) }), group: r.group_name, href: `/groups/${r.group_id}?tab=payments`, badge: t("home.badgeConfirm"), tone: "warn" });
  const reqs = await q(
    `select r.id, r.group_id, r.amount_minor, r.currency, g.name as group_name, tm.display_name as to_name
     from payment_requests r join members fm on fm.id=r.from_member join members tm on tm.id=r.to_member join groups g on g.id=r.group_id
     where r.status in ('pending','failed') and r.expires_at > now() and fm.user_id=$1 and fm.status='active' order by r.created_at desc limit 5`, [userId]);
  for (const r of reqs) out.push({ key: r.id, person: r.to_name, title: t("home.pendingPay", { name: r.to_name, amount: formatMoney(r.amount_minor, r.currency) }), group: r.group_name, href: `/groups/${r.group_id}?tab=payments`, badge: t("home.badgePay"), tone: "info" });
  const claims = await q(
    `select c.id, c.group_id, g.name as group_name, u.display_name from claim_requests c join groups g on g.id=c.group_id join users u on u.id=c.user_id
     join members me on me.group_id=c.group_id and me.user_id=$1 and me.role='admin' and me.status='active' where c.status='pending' limit 5`, [userId]);
  for (const c of claims) out.push({ key: c.id, person: c.display_name, title: t("home.pendingClaim", { name: c.display_name }), group: c.group_name, href: `/groups/${c.group_id}?tab=members`, badge: t("home.badgeApprove"), tone: "warn" });
  return out;
}

function Landing() {
  const steps = [
    { icon: Link2, title: t("landing.s1t"), body: t("landing.s1b"), tone: "bg-brand-50 text-brand-700" },
    { icon: ReceiptText, title: t("landing.s2t"), body: t("landing.s2b"), tone: "bg-warm-50 text-warm-700" },
    { icon: Scale, title: t("landing.s3t"), body: t("landing.s3b"), tone: "bg-sky-50 text-sky-700" },
  ];
  const people = [{ n: "Zeynep", a: "₺620,25", ok: true }, { n: "Can", a: "₺620,25", ok: false }, { n: "Defne", a: "₺620,25", ok: true }];
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 pb-10 pt-8">
      <div className="row"><Wordmark /><ThemeButton /></div>
      <h1 className="mt-8 text-[2.4rem] font-extrabold leading-[1.05] tracking-tight">{t("landing.h1a")}<br /><span className="bg-gradient-to-r from-brand-500 to-brand-800 bg-clip-text text-transparent">{t("landing.h1b")}</span></h1>
      <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">{t("landing.lead")}</p>

      <div aria-hidden className="relative mt-8">
        <div className="hero animate-rise">
          <div className="row"><p className="font-extrabold">🏖️ Bodrum Hafta Sonu</p><span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold">4 kişi</span></div>
          <p className="mt-4 text-[12px] font-bold text-white/70">Villa kirası · Tan ödedi</p>
          <p className="text-3xl font-extrabold">₺2.481,00</p>
          <ul className="mt-4 grid gap-2">
            {people.map((p) => (
              <li key={p.n} className="hero-glass flex items-center gap-3 px-3 py-2">
                <Avatar name={p.n} size="sm" />
                <span className="flex-1 text-sm font-bold">{p.n}</span>
                <span className="text-sm font-extrabold">{p.a}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.ok ? "bg-brand-100 text-brand-800" : "bg-warm-100 text-warm-700"}`}>{p.ok ? "Ödedi ✓" : "Bekliyor"}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="absolute -right-2 -top-4 animate-pop rounded-2xl bg-paper-card px-3 py-2 text-sm font-extrabold shadow-card ring-1 ring-paper-line [animation-delay:300ms]">💸 Ödeşildi!</div>
      </div>

      <div className="mt-8 grid gap-2.5">
        <Link href="/login?mode=start&next=/groups/new" className="btn-primary min-h-[58px] text-base">{t("landing.cta")} <ArrowRight aria-hidden className="h-5 w-5" /></Link>
        <Link href="/login" className="btn-secondary">{t("landing.login")}</Link>
        <p className="text-center text-sm text-ink-mute">{t("landing.noApp")}</p>
      </div>

      <ol className="mt-10 grid gap-3">
        {steps.map((s, i) => (
          <li key={i} className="card flex gap-4 !p-4">
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${s.tone}`}><s.icon aria-hidden className="h-6 w-6" /></span>
            <div><p className="font-extrabold">{i + 1}. {s.title}</p><p className="mt-0.5 text-[15px] text-ink-mute">{s.body}</p></div>
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
