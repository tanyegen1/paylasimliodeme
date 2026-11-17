import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronRight, FileText, MessageSquareText, Plus, ReceiptText, Repeat, Settings, UserPlus } from "lucide-react";
import { requireUser } from "@/server/session";
import { getGroupContext, listCouples } from "@/server/groups";
import { computeGroupBalances } from "@/server/ledger";
import { listExpenses } from "@/server/expenses";
import { listPaymentActivity } from "@/server/payments";
import { listReceipts } from "@/server/receipts";
import { listClaims, listInvites } from "@/server/invites";
import { runRecurring } from "@/server/recurring";
import { getPaymentProvider } from "@/server/providers/payment";
import { AppError } from "@/server/errors";
import { q1 } from "@/server/db";
import { ActionTile, Avatar, AvatarStack, Badge, BalanceText, Celebrate, Empty, Header, Notice, Page } from "@/components/ui";
import { ActButton } from "@/components/client";
import { decideClaimAction, decideReportAction, respondDateAction, restoreExpenseAction, reversePaymentAction, cancelRequestAction, respondCoupleAction, activateRequestAction } from "@/app/actions";
import { CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { GROUP_EMOJI, GROUP_TILE } from "@/lib/group-types";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatShortDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AddPlaceholder, CouplePropose, IncludeMember, InvitePanel, MemberEdit, RequestShare, SettingsForm, TransferActions } from "./client";

const TABS = ["expenses", "settle", "people"] as const;
type Tab = (typeof TABS)[number] | "settings";
/** Eski bağlantılar (bildirimler, e-postalar) yeni sekmelere yönlenir. */
const ALIAS: Record<string, Tab> = { summary: "expenses", expenses: "expenses", balances: "settle", payments: "settle", settle: "settle", members: "people", people: "people", settings: "settings" };

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; deleted?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/groups/${id}`);
  let ctx;
  try {
    ctx = await getGroupContext(id, user.id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { group, me, members } = ctx;
  // Zamanlayıcı yoksa da tekrarlayan giderler kaçmasın: sayfa açılışında vadesi gelenler üretilir (çift kayıt korumalı).
  await runRecurring(undefined, id).catch(() => 0);
  const tab: Tab = ALIAS[sp.tab ?? ""] ?? "expenses";
  const name = (mid: string) => members.find((m) => m.id === mid)?.display_name ?? "?";
  const active = members.filter((m) => m.status === "active");
  const balances = await computeGroupBalances(id);
  const unitName = (mid: string) => {
    const partner = Object.entries(balances.units).find(([, rep]) => rep === mid)?.[0];
    return partner ? `${name(mid)} & ${name(partner)}` : name(mid);
  };
  const myUnit = balances.units[me.id] ?? me.id;

  const myNets = balances.currencies.map((c) => [c, balances.nets[c][me.id] ?? 0] as const).filter(([, v]) => v !== 0);
  const myTransfers = balances.transfers.filter((x) => x.from === myUnit || x.to === myUnit);
  const [expenseCount, receipts, claims] = await Promise.all([
    q1<{ n: number }>(`select count(*)::int n from expenses where group_id=$1 and deleted_at is null and status='active'`, [id]).then((r) => r?.n ?? 0),
    listReceipts(id, user.id), listClaims(id, user.id),
  ]);
  const { reports } = await listPaymentActivity(id, user.id);
  const toConfirm = reports.filter((r) => r.status === "reported" && (members.find((m) => m.id === r.to_member)?.user_id === user.id || (!members.find((m) => m.id === r.to_member)?.user_id && me.role === "admin")));
  const settled = expenseCount > 0 && myNets.length === 0 && balances.transfers.length === 0;

  if (tab === "settings") {
    return (
      <Page>
        <Header title={t("settings.title")} back={`/groups/${id}`} subtitle={group.name} />
        <SettingsForm group={{ id, name: group.name, simplify: group.simplify_debts, schedule: group.settle_schedule, settleDate: group.settle_date, startDate: group.start_date, endDate: group.end_date, type: group.type, archived: !!group.archived_at }} isAdmin={me.role === "admin"} myMemberId={me.id} />
      </Page>
    );
  }

  return (
    <Page>
      <header className="mb-5 flex items-center gap-3">
        <Link href="/groups" aria-label={t("common.back")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-card text-ink-soft shadow-card ring-1 ring-paper-line transition active:scale-95"><ChevronRight aria-hidden className="h-5 w-5 rotate-180" /></Link>
        <span aria-hidden className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl ${GROUP_TILE[group.type]}`}>{GROUP_EMOJI[group.type]}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate !text-[1.35rem]">{group.name}</h1>
          <div className="mt-0.5 flex items-center gap-2"><AvatarStack names={active.map((m) => m.display_name)} max={5} /><span className="whitespace-nowrap text-xs font-semibold text-ink-mute">{t("groups.members", { n: active.length })}</span>{group.is_demo && <Badge tone="warn">DEMO</Badge>}</div>
        </div>
        <Link href={`/groups/${id}?tab=settings`} aria-label={t("settings.title")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper-card text-ink-soft shadow-card ring-1 ring-paper-line transition active:scale-95"><Settings aria-hidden className="h-5 w-5" /></Link>
      </header>
      {group.archived_at && <div className="mb-3"><Notice tone="warn">{t("group.archivedNote")}</Notice></div>}

      <section className="hero">
        {settled && <Celebrate />}
        <p className="text-[13px] font-bold uppercase tracking-wider text-white/70">{t("group.myBalance")}</p>
        {expenseCount === 0 ? (
          <p className="mt-1.5 text-2xl font-extrabold">{t("group.noExpensesYet")}</p>
        ) : myNets.length === 0 ? (
          <p className="mt-1.5 text-2xl font-extrabold">{t("balance.settledLong")}</p>
        ) : (
          myNets.map(([c, v]) => (
            <p key={c} className="mt-1"><span className={`text-sm font-bold ${v > 0 ? "text-white/85" : "text-warm-200"}`}>{v > 0 ? t("balance.youAreOwed") : t("balance.youOwe")}</span><span className="block text-[2.1rem] font-extrabold leading-tight">{formatMoney(Math.abs(v), c)}</span></p>
          ))
        )}
        {myTransfers.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {myTransfers.slice(0, 3).map((x, i) => (
              <li key={i} className="hero-glass flex items-center gap-3 px-3 py-2.5">
                <Avatar name={unitName(x.from === myUnit ? x.to : x.from)} size="sm" />
                <p className="min-w-0 flex-1 text-sm leading-snug">
                  <span className="block truncate font-bold">{unitName(x.from === myUnit ? x.to : x.from)}</span>
                  <span className="text-white/75">{x.from === myUnit ? t("group.youPayShort", { amount: formatMoney(x.amount, x.currency) }) : t("group.paysYouShort", { amount: formatMoney(x.amount, x.currency) })}</span>
                </p>
                <TransferActions dark compact groupId={id} groupName={group.name} transfer={x} fromName={unitName(x.from)} toName={unitName(x.to)} role={x.from === myUnit ? "debtor" : "creditor"} debtorHasAccount={!!members.find((m) => m.id === x.from)?.user_id} />
              </li>
            ))}
          </ul>
        )}
        {myTransfers.length > 0 && <Link href={`/groups/${id}?tab=settle`} className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-white/85 hover:text-white">{t("group.settleDetails")} <ChevronRight aria-hidden className="h-4 w-4" /></Link>}
        {expenseCount === 0 && <p className="mt-2 text-[15px] text-white/80">{active.length === 1 ? t("group.aloneBody") : t("group.firstExpenseHint")}</p>}
      </section>

      <nav aria-label={t("group.quick")} className="mt-5 grid grid-cols-4 gap-2">
        <ActionTile href={`/groups/${id}/expenses/new`} icon={<Plus aria-hidden className="h-6 w-6" strokeWidth={2.6} />} label={t("group.tileAdd")} />
        <ActionTile href={`/groups/${id}/receipts/new`} icon={<ReceiptText aria-hidden className="h-6 w-6" />} label={t("group.tileReceipt")} tone="warm" />
        <ActionTile href={`/groups/${id}/quick`} icon={<MessageSquareText aria-hidden className="h-6 w-6" />} label={t("group.tileQuick")} tone="sky" />
        <ActionTile href={`/groups/${id}?tab=people#invite`} icon={<UserPlus aria-hidden className="h-6 w-6" />} label={t("group.tileInvite")} tone="violet" />
      </nav>

      {(toConfirm.length > 0 || claims.length > 0 || receipts.length > 0) && (
        <div className="mt-5 grid gap-2">
          {toConfirm.map((r) => (
            <Link key={r.id} href={`/groups/${id}?tab=settle`} className="flex items-center gap-3 rounded-2xl bg-warm-50 px-4 py-3 text-sm text-warm-700 ring-1 ring-warm-200">
              <Avatar name={name(r.from_member)} size="sm" /><span className="flex-1"><b>{t("group.confirmBanner", { name: name(r.from_member), amount: formatMoney(r.amount_minor, r.currency) })}</b></span><ChevronRight aria-hidden className="h-5 w-5" />
            </Link>
          ))}
          {claims.map((c) => (
            <Link key={c.id} href={`/groups/${id}?tab=people`} className="flex items-center gap-3 rounded-2xl bg-warm-50 px-4 py-3 text-sm text-warm-700 ring-1 ring-warm-200">
              <Avatar name={c.requester_name} size="sm" /><span className="flex-1"><b>{t("home.pendingClaim", { name: c.requester_name })}</b></span><ChevronRight aria-hidden className="h-5 w-5" />
            </Link>
          ))}
          {receipts.map((r) => (
            <Link key={r.id} href={`/groups/${id}/receipts/${r.id}`} className="flex items-center gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-100">
              <ReceiptText aria-hidden className="h-5 w-5 shrink-0" /><span className="flex-1"><b>{r.title}</b> · {r.status === "draft" ? t("receipt.statusDraft") : t("receipt.unclaimedCount", { n: r.unclaimed })}</span><ChevronRight aria-hidden className="h-5 w-5" />
            </Link>
          ))}
        </div>
      )}

      <nav aria-label={t("group.tabs")} className="sticky top-0 z-10 -mx-4 mt-6 bg-paper/90 px-4 py-2 backdrop-blur">
        <ul className="grid grid-cols-3 gap-1 rounded-2xl bg-paper-sunk p-1">
          {TABS.map((x) => (
            <li key={x}><Link href={`/groups/${id}?tab=${x}`} aria-current={tab === x ? "page" : undefined} className={`flex min-h-[42px] items-center justify-center rounded-xl text-sm font-bold transition ${tab === x ? "bg-paper-card text-ink shadow-card" : "text-ink-mute"}`}>{t(`group.tab_${x}`)}</Link></li>
          ))}
        </ul>
      </nav>

      <div className="mt-3">
        {tab === "expenses" && <Expenses />}
        {tab === "settle" && <><Balances /><Payments /></>}
        {tab === "people" && <Members />}
      </div>
    </Page>
  );

  async function Expenses() {
    const all = await listExpenses(id, user.id, { includeDeleted: sp.deleted === "1" });
    const live = all.filter((e) => !e.deleted_at);
    const deleted = all.filter((e) => e.deleted_at);
    const extras = (
      <div className="flex flex-wrap gap-2">
        {group.type === "home" && <Link href={`/groups/${id}/recurring`} className="chip"><Repeat aria-hidden className="h-4 w-4" />{t("group.recurring")}</Link>}
        <Link href={`/groups/${id}/summary`} className="chip"><FileText aria-hidden className="h-4 w-4" />{group.type === "home" ? t("group.monthly") : t("group.report")}</Link>
      </div>
    );
    if (!all.length) return <div className="grid gap-4"><Empty icon="🧾" title={t("expenses.emptyTitle")} body={t("expenses.emptyBody")}><Link href={`/groups/${id}/expenses/new`} className="btn-primary">{t("group.addExpense")}</Link></Empty>{extras}</div>;
    // Tarihe göre gruplanmış liste
    const days: { date: string; items: typeof live }[] = [];
    for (const e of live) {
      const key = e.status === "draft" ? "draft" : e.expense_date;
      const d = days.find((x) => x.date === key);
      if (d) d.items.push(e); else days.push({ date: key, items: [e] });
    }
    return (
      <div className="grid gap-4">
        {days.map((d) => (
          <section key={d.date}>
            <h3 className="mb-2 px-1 text-[13px] font-bold text-ink-mute">{d.date === "draft" ? t("expenses.waiting") : formatDate(d.date)}</h3>
            <ul className="card divide-y divide-paper-line/80 !p-1">
              {d.items.map((e) => (
                <li key={e.id}>
                  <Link href={e.status === "draft" ? `/groups/${id}/expenses/${e.id}/edit` : `/groups/${id}/expenses/${e.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-paper">
                    <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-paper text-[22px]">{CATEGORY_EMOJI[e.category as Category] ?? "🧾"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2"><span className="truncate text-[15px] font-bold">{e.title}</span>{e.open_requests > 0 && <Badge tone="warn">{t("expenses.correction")}</Badge>}</span>
                      <span className="block truncate text-[13px] text-ink-mute">{e.status === "draft" ? t("expenses.draft") : t("expenses.paidBy", { name: e.payer_names.join(", ") })}</span>
                    </span>
                    <span className="text-right">
                      {e.status === "draft" ? <Badge tone="warn">{t("expenses.enterAmount")}</Badge> : (
                        <>
                          <span className="block text-[15px] font-extrabold">{formatMoney(e.amount_minor, e.currency)}</span>
                          <span className={`block text-xs font-semibold ${e.my_paid - e.my_share > 0 ? "text-brand-700" : e.my_share > 0 ? "text-warm-700" : "text-ink-faint"}`}>
                            {e.my_share > 0 ? t("expenses.yourShare", { amount: formatMoney(e.my_share, e.currency) }) : t("expenses.notIncluded")}
                          </span>
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {extras}
        {sp.deleted === "1" ? (
          deleted.length > 0 && (
            <div>
              <h2 className="section-title">{t("expenses.deleted")}</h2>
              <ul className="card divide-y divide-paper-line !p-1">
                {deleted.map((e) => (
                  <li key={e.id} className="row px-3 py-3">
                    <span className="min-w-0"><span className="block truncate font-semibold line-through opacity-70">{e.title}</span><span className="muted text-xs">{formatMoney(e.amount_minor, e.currency)} · {formatShortDate(e.expense_date)}</span></span>
                    {!e.receipt_id && <ActButton action={restoreExpenseAction.bind(null, id, e.id)} label={t("expenses.restore")} />}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <Link href={`/groups/${id}?tab=expenses&deleted=1`} className="justify-self-center text-sm font-semibold text-ink-mute underline-offset-4 hover:underline">{t("expenses.showDeleted")}</Link>
        )}
      </div>
    );
  }

  function Balances() {
    const any = balances.currencies.length > 0;
    if (!any) return <Empty icon="⚖️" title={t("balances.emptyTitle")} body={t("balances.emptyBody")} />;
    return (
      <div className="grid gap-5">
        <section>
          <h2 className="section-title !mt-1">{t("balances.whoPaysWhom")}</h2>
          {balances.transfers.length === 0 ? (
            <div className="hero text-center"><Celebrate /><p aria-hidden className="text-4xl">🎉</p><p className="mt-2 text-xl font-extrabold">{t("balance.settledLong")}</p></div>
          ) : (
            <ul className="grid gap-2.5">
              {balances.transfers.map((x, i) => {
                const mineAs = x.from === myUnit ? "debtor" : x.to === myUnit ? "creditor" : me.role === "admin" ? "admin" : null;
                return (
                  <li key={i} className="card grid gap-3 !p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center"><Avatar name={unitName(x.from)} size="sm" /><span aria-hidden className="mx-1.5 text-ink-faint">→</span><Avatar name={unitName(x.to)} size="sm" /></span>
                      <p className="min-w-0 flex-1 text-sm leading-snug"><b>{unitName(x.from)}</b> <span className="text-ink-mute">→</span> <b>{unitName(x.to)}</b></p>
                      <p className="text-[17px] font-extrabold">{formatMoney(x.amount, x.currency)}</p>
                    </div>
                    {mineAs && <TransferActions groupId={id} groupName={group.name} transfer={x} fromName={unitName(x.from)} toName={unitName(x.to)} role={mineAs} debtorHasAccount={!!members.find((m) => m.id === x.from)?.user_id} />}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 px-1 text-xs leading-relaxed text-ink-mute">{balances.simplified ? t("balances.simplifiedNote") : t("balances.pairwiseNote")} {t("balances.planNote")}</p>
        </section>
        {balances.currencies.map((c) => (
          <section key={c}>
            <h2 className="section-title !mt-0">{t("balances.everyone")}{balances.currencies.length > 1 ? ` · ${c}` : ""}</h2>
            <ul className="card divide-y divide-paper-line/80 !p-1">
              {members.filter((m) => m.status === "active" || (balances.nets[c][m.id] ?? 0) !== 0).map((m) => (
                <li key={m.id}>
                  <Link href={`/groups/${id}/balance/${m.id}`} className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-paper">
                    <Avatar name={m.display_name} size="sm" />
                    <span className="flex-1 truncate text-[15px] font-semibold">{m.display_name}{m.id === me.id && <span className="text-ink-mute font-normal"> ({t("common.you")})</span>}{m.status === "left" && <span className="text-ink-mute font-normal"> · {t("members.left")}</span>}</span>
                    <BalanceText net={balances.nets[c][m.id] ?? 0} currency={c} mine={m.id === me.id} className="text-sm" />
                    <ChevronRight aria-hidden className="h-4 w-4 text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  async function Payments() {
    const { requests, reports, payments } = await listPaymentActivity(id, user.id);
    const provider = getPaymentProvider();
    const userOf = (mid: string) => members.find((m) => m.id === mid)?.user_id;
    const canActFor = (mid: string) => userOf(mid) === user.id || (!userOf(mid) && me.role === "admin");
    const openReports = reports.filter((r) => r.status === "reported");
    const openReqs = requests.filter((r) => ["draft", "pending", "processing", "failed"].includes(r.status));
    const reqTone = { draft: "neutral", pending: "info", processing: "warn", verified: "ok", failed: "bad", cancelled: "neutral", expired: "neutral" } as const;
    if (!requests.length && !reports.length && !payments.length) return null;
    return (
      <div className="mt-6 grid gap-4">
        {!provider && <Notice>{t("payments.manualOnly")}</Notice>}
        {provider?.isDemo && <Notice tone="warn">{t("payments.sandboxNote")}</Notice>}
        {openReports.length > 0 && (
          <section>
            <h2 className="section-title !mt-0">{t("payments.awaitingConfirm")}</h2>
            <ul className="grid gap-2">
              {openReports.map((r) => (
                <li key={r.id} className="card grid gap-2">
                  <p className="text-sm"><b>{name(r.from_member)}</b> → <b>{name(r.to_member)}</b><span className="float-right font-bold">{formatMoney(r.amount_minor, r.currency)}</span></p>
                  <p><Badge tone="warn">{t("payLabel.reported")}</Badge> <span className="muted text-xs">{formatDateTime(r.created_at)}{r.reported_via === "pay_link" ? ` · ${t("payments.viaLink")}` : ""}</span></p>
                  {r.note && <p className="muted">“{r.note}”</p>}
                  {canActFor(r.to_member) ? (
                    <div className="flex gap-2">
                      <ActButton action={decideReportAction.bind(null, id, r.id, true)} label={t("payments.confirm")} className="btn-primary btn-sm" />
                      <ActButton action={decideReportAction.bind(null, id, r.id, false)} label={t("payments.reject")} confirm={t("payments.rejectConfirm")} />
                    </div>
                  ) : <p className="muted text-xs">{t("payments.waitingFor", { name: name(r.to_member) })}</p>}
                  <p className="muted text-xs">{t("payments.proofNote")}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {openReqs.length > 0 && (
          <section>
            <h2 className="section-title !mt-0">{t("payments.requests")}</h2>
            <ul className="grid gap-2">
              {openReqs.map((r) => (
                <li key={r.id} className="card grid gap-2">
                  <p className="text-sm"><b>{name(r.from_member)}</b> → <b>{name(r.to_member)}</b><span className="float-right font-bold">{formatMoney(r.amount_minor, r.currency)}</span></p>
                  <p className="flex flex-wrap items-center gap-2"><Badge tone={reqTone[r.status]}>{t(`requestStatus.${r.status}`)}</Badge>
                    {r.paid_minor > 0 && <span className="muted text-xs">{t("payments.paidPart", { paid: formatMoney(r.paid_minor, r.currency) })}</span>}
                    <span className="muted text-xs">{t("payments.expires", { date: formatDate(r.expires_at) })}</span></p>
                  {r.proposed_date && r.proposal_status && (
                    <div className="rounded-xl bg-paper px-3 py-2 text-sm">
                      {t(`payments.proposal_${r.proposal_status}` as "payments.proposal_pending", { name: name(r.from_member), date: formatDate(r.proposed_date) })}
                      {r.proposal_status === "pending" && canActFor(r.to_member) && (
                        <div className="mt-2 flex gap-2">
                          <ActButton action={respondDateAction.bind(null, id, r.id, true)} label={t("payments.acceptDate")} className="btn-primary btn-sm" />
                          <ActButton action={respondDateAction.bind(null, id, r.id, false)} label={t("payments.declineDate")} />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {r.status === "draft" ? <ActButton action={activateRequestAction.bind(null, id, r.id)} label={t("payments.activate")} className="btn-primary btn-sm" />
                      : (canActFor(r.to_member) || canActFor(r.from_member) || me.role === "admin") && <RequestShare groupId={id} requestId={r.id} groupName={group.name} toName={name(r.to_member)} amount={formatMoney(r.amount_minor - r.paid_minor, r.currency)} mine={canActFor(r.from_member)} />}
                    {(canActFor(r.to_member) || me.role === "admin") && r.status !== "processing" && <ActButton action={cancelRequestAction.bind(null, id, r.id)} label={t("payments.cancel")} confirm={t("payments.cancelConfirm")} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {payments.length > 0 && (
          <section>
            <h2 className="section-title !mt-0">{t("payments.history")}</h2>
            <ul className="card divide-y divide-paper-line p-0">
              {payments.map((p) => (
                <li key={p.id} className="grid gap-1 px-4 py-3">
                  <p className={`text-sm ${p.reversed_at ? "line-through opacity-60" : ""}`}><b>{name(p.from_member)}</b> → <b>{name(p.to_member)}</b><span className="float-right font-bold">{formatMoney(p.amount_minor, p.currency)}</span></p>
                  <p className="flex flex-wrap items-center gap-2">
                    {p.reversed_at ? <Badge tone="bad">{t("payLabel.reversed")}</Badge> : p.source === "provider" ? <Badge tone="ok">{t("payLabel.providerVerified")}</Badge> : <Badge tone="info">{t("payLabel.recipientConfirmed")}</Badge>}
                    <span className="muted text-xs">{formatDateTime(p.created_at)}</span>
                  </p>
                  {!p.reversed_at && p.source === "manual" && (canActFor(p.to_member) || me.role === "admin") && <ActButton action={reversePaymentAction.bind(null, id, p.id)} label={t("payments.undo")} className="btn-ghost btn-sm -ml-3" confirm={t("payments.undoConfirm")} />}
                </li>
              ))}
            </ul>
            {requests.filter((r) => ["cancelled", "expired"].includes(r.status)).length > 0 && <p className="muted mt-2 text-xs">{t("payments.closedCount", { n: requests.filter((r) => ["cancelled", "expired"].includes(r.status)).length })}</p>}
          </section>
        )}
      </div>
    );
  }

  async function Members() {
    const [claims, invites, couples, expenses] = await Promise.all([listClaims(id, user.id), listInvites(id, user.id), listCouples(id), group.type === "trip" ? listExpenses(id, user.id) : Promise.resolve([])]);
    const canInvite = me.role !== "guest";
    const coupleOf = (mid: string) => couples.find((c) => c.member_a === mid || c.member_b === mid);
    const myCouple = coupleOf(me.id);
    const equalExpenses = expenses.filter((e) => e.split_type === "equal" && e.status === "active" && !e.deleted_at && !e.receipt_id).map((e) => ({ id: e.id, title: e.title, date: formatShortDate(e.expense_date), amount: formatMoney(e.amount_minor, e.currency), members: (e.split_meta as { memberIds?: string[] }).memberIds ?? [] }));
    return (
      <div className="grid gap-4">
        {claims.length > 0 && (
          <section className="grid gap-2">
            {claims.map((c) => (
              <div key={c.id} className="rounded-2xl border border-warm-600/30 bg-warm-50 p-4 text-sm text-warm-700">
                <p>{t("members.claimAsk", { requester: c.requester_name, placeholder: c.placeholder_name })}</p>
                <p className="mt-1 text-xs">{t("members.claimWarn", { placeholder: c.placeholder_name })}</p>
                <div className="mt-3 flex gap-2">
                  <ActButton action={decideClaimAction.bind(null, id, c.id, true)} label={t("members.claimApprove")} className="btn-primary btn-sm" />
                  <ActButton action={decideClaimAction.bind(null, id, c.id, false)} label={t("members.claimReject")} />
                </div>
              </div>
            ))}
          </section>
        )}
        {canInvite ? (
          <section id="invite" className="card grid gap-3 scroll-mt-20">
            <div className="flex items-center gap-3"><span aria-hidden className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-2xl">💌</span><h2>{t("members.inviteTitle")}</h2></div>
            <p className="muted">{t("members.inviteBody")}</p>
            <InvitePanel groupId={id} groupName={group.name} inviterName={me.display_name} activeLinks={invites.map((i) => ({ id: i.id, label: i.target_name ? t("members.linkFor", { name: i.target_name }) : t("members.linkGeneral"), meta: t("members.linkMeta", { date: formatDate(i.expires_at), n: i.use_count }) }))} canRevoke={me.role === "admin"} />
            <div className="border-t border-paper-line pt-3"><AddPlaceholder groupId={id} /></div>
          </section>
        ) : <Notice>{t("members.guestNote")} <Link className="font-semibold underline" href="/profile#secure">{t("home.secureTitle")}</Link></Notice>}

        <h2 className="section-title !mb-0 !mt-2">{t("members.title", { n: active.length })}</h2>
        <ul className="card divide-y divide-paper-line/80 !p-1">
          {active.map((m) => {
            const c = coupleOf(m.id);
            return (
              <li key={m.id} className="flex items-center gap-3 rounded-2xl px-3 py-3">
                <Avatar name={m.display_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">{m.display_name}{m.id === me.id && <span className="muted font-normal"> ({t("common.you")})</span>}</p>
                  <p className="flex flex-wrap gap-1.5">
                    {m.role === "admin" && <Badge tone="ok">{t("members.admin")}</Badge>}
                    {m.role === "guest" && <Badge>{t("members.guest")}</Badge>}
                    {!m.user_id && <Badge tone="warn">{t("members.notJoined")}</Badge>}
                    {c?.status === "accepted" && <Badge tone="info">{t("members.couple", { name: name(c.member_a === m.id ? c.member_b : c.member_a) })}</Badge>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  {!m.user_id && me.role === "admin" && <InvitePanel groupId={id} groupName={group.name} inviterName={me.display_name} target={{ id: m.id, name: m.display_name }} compact />}
                  {group.type === "trip" && me.role !== "guest" && <IncludeMember groupId={id} memberId={m.id} memberName={m.display_name} expenses={equalExpenses.filter((e) => !e.members.includes(m.id))} />}
                  {(m.id === me.id || me.role === "admin") && <MemberEdit groupId={id} isSelf={m.id === me.id} canAdmin={me.role === "admin"} showStay={group.type === "home"} member={{ id: m.id, name: m.display_name, role: m.role, hasAccount: !!m.user_id, stayFrom: m.stay_from, stayTo: m.stay_to }} />}
                </div>
              </li>
            );
          })}
        </ul>
        {members.some((m) => m.status === "left") && <p className="muted text-xs">{t("members.leftNote", { names: members.filter((m) => m.status === "left").map((m) => m.display_name).join(", ") })}</p>}

        {group.type === "trip" && (
          <section className="card grid gap-2">
            <h2>{t("couple.title")}</h2>
            <p className="muted">{t("couple.body")}</p>
            {myCouple ? (
              <div className="grid gap-2 text-sm">
                <p>{myCouple.status === "accepted" ? t("couple.active", { name: name(myCouple.member_a === me.id ? myCouple.member_b : myCouple.member_a) }) : myCouple.member_a === me.id ? t("couple.waiting", { name: name(myCouple.member_b) }) : t("couple.asked", { name: name(myCouple.member_a) })}</p>
                <div className="flex gap-2">
                  {myCouple.status === "pending" && myCouple.member_b === me.id && <ActButton action={respondCoupleAction.bind(null, id, myCouple.id, "accept")} label={t("couple.accept")} className="btn-primary btn-sm" />}
                  <ActButton action={respondCoupleAction.bind(null, id, myCouple.id, "end")} label={myCouple.status === "accepted" ? t("couple.end") : t("couple.decline")} />
                </div>
              </div>
            ) : <CouplePropose groupId={id} options={active.filter((m) => m.id !== me.id && m.user_id && !coupleOf(m.id)).map((m) => ({ id: m.id, name: m.display_name }))} />}
          </section>
        )}
      </div>
    );
  }
}
