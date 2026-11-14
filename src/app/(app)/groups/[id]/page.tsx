import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, ChevronRight, FileText, MessageSquareText, Plus, ReceiptText, Repeat } from "lucide-react";
import { requireUser } from "@/server/session";
import { getGroupContext, listCouples } from "@/server/groups";
import { computeGroupBalances } from "@/server/ledger";
import { listExpenses } from "@/server/expenses";
import { listPaymentActivity } from "@/server/payments";
import { listReceipts } from "@/server/receipts";
import { listClaims, listInvites } from "@/server/invites";
import { runRecurring } from "@/server/recurring";
import { groupActivity } from "@/server/activity";
import { getPaymentProvider } from "@/server/providers/payment";
import { AppError } from "@/server/errors";
import { Avatar, Badge, BalanceText, Empty, Header, Notice, Page } from "@/components/ui";
import { ActButton } from "@/components/client";
import { ActivityList } from "@/components/activity";
import { decideClaimAction, decideReportAction, respondDateAction, restoreExpenseAction, reversePaymentAction, cancelRequestAction, respondCoupleAction, activateRequestAction } from "@/app/actions";
import { CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { GROUP_EMOJI } from "@/lib/group-types";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, formatShortDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AddPlaceholder, CouplePropose, IncludeMember, InvitePanel, MemberEdit, RequestShare, SettingsForm, TransferActions } from "./client";

const TABS = ["summary", "expenses", "balances", "payments", "members", "settings"] as const;
type Tab = (typeof TABS)[number];

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
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "summary";
  const name = (mid: string) => members.find((m) => m.id === mid)?.display_name ?? "?";
  const active = members.filter((m) => m.status === "active");
  const balances = await computeGroupBalances(id);
  const unitName = (mid: string) => {
    const partner = Object.entries(balances.units).find(([, rep]) => rep === mid)?.[0];
    return partner ? `${name(mid)} & ${name(partner)}` : name(mid);
  };
  const myUnit = balances.units[me.id] ?? me.id;

  return (
    <Page>
      <Header title={group.name} back="/groups" subtitle={`${GROUP_EMOJI[group.type]} ${t(`groupType.${group.type}`)} · ${t("groups.members", { n: active.length })}`}
        action={group.is_demo ? <Badge tone="warn">DEMO</Badge> : undefined} />
      <nav aria-label={t("group.tabs")} className="-mx-4 mb-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1.5">
          {TABS.map((x) => (
            <li key={x}><Link href={`/groups/${id}?tab=${x}`} aria-current={tab === x ? "page" : undefined} className={`chip ${tab === x ? "chip-on" : ""}`}>{t(`group.tab_${x}`)}</Link></li>
          ))}
        </ul>
      </nav>
      {group.archived_at && <div className="mb-3"><Notice tone="warn">{t("group.archivedNote")}</Notice></div>}

      {tab === "summary" && <Summary />}
      {tab === "expenses" && <Expenses />}
      {tab === "balances" && <Balances />}
      {tab === "payments" && <Payments />}
      {tab === "members" && <Members />}
      {tab === "settings" && <SettingsForm group={{ id, name: group.name, simplify: group.simplify_debts, schedule: group.settle_schedule, settleDate: group.settle_date, startDate: group.start_date, endDate: group.end_date, type: group.type, archived: !!group.archived_at }} isAdmin={me.role === "admin"} myMemberId={me.id} />}
    </Page>
  );

  async function Summary() {
    const [expenses, receipts, activity] = await Promise.all([listExpenses(id, user.id), listReceipts(id, user.id), groupActivity(id, user.id, 5)]);
    const drafts = expenses.filter((e) => e.status === "draft" && !e.deleted_at);
    const myTransfers = balances.transfers.filter((x) => x.from === myUnit || x.to === myUnit);
    const actions = [
      { href: `/groups/${id}/expenses/new`, icon: Plus, label: t("group.addExpense") },
      { href: `/groups/${id}/receipts/new`, icon: ReceiptText, label: t("group.shareReceipt") },
      { href: `/groups/${id}/quick`, icon: MessageSquareText, label: t("group.quickAdd") },
      ...(group.type === "home" ? [{ href: `/groups/${id}/recurring`, icon: Repeat, label: t("group.recurring") }] : []),
      { href: `/groups/${id}/summary`, icon: FileText, label: group.type === "home" ? t("group.monthly") : t("group.report") },
    ];
    return (
      <div className="grid gap-4">
        <section className="card">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">{t("group.myBalance")}</p>
          {balances.currencies.filter((c) => (balances.nets[c][me.id] ?? 0) !== 0).length === 0 ? (
            <p className="mt-1 text-xl font-bold">{expenses.length ? t("balance.settledLong") : t("group.noExpensesYet")}</p>
          ) : (
            balances.currencies.map((c) => (balances.nets[c][me.id] ?? 0) !== 0 && <p key={c} className="mt-1 text-xl"><BalanceText net={balances.nets[c][me.id]} currency={c} /></p>)
          )}
          {myTransfers.length > 0 && (
            <ul className="mt-3 grid gap-3 border-t border-paper-line pt-3">
              {myTransfers.map((x, i) => (
                <li key={i} className="grid gap-2">
                  <p className="text-sm">{x.from === myUnit ? t("group.youPay", { name: unitName(x.to), amount: formatMoney(x.amount, x.currency) }) : t("group.paysYou", { name: unitName(x.from), amount: formatMoney(x.amount, x.currency) })}</p>
                  <TransferActions groupId={id} groupName={group.name} transfer={x} fromName={unitName(x.from)} toName={unitName(x.to)} role={x.from === myUnit ? "debtor" : "creditor"} debtorHasAccount={!!members.find((m) => m.id === x.from)?.user_id} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {drafts.map((d) => (
          <Link key={d.id} href={`/groups/${id}/expenses/${d.id}/edit`} className="flex items-center gap-3 rounded-2xl border border-warm-600/30 bg-warm-50 px-4 py-3 text-sm text-warm-700">
            <CalendarClock aria-hidden className="h-5 w-5 shrink-0" />
            <span className="flex-1"><b>{d.title}</b> · {t("group.draftWaiting", { date: formatShortDate(d.expense_date) })}</span>
            <ChevronRight aria-hidden className="h-5 w-5" />
          </Link>
        ))}
        {receipts.map((r) => (
          <Link key={r.id} href={`/groups/${id}/receipts/${r.id}`} className="flex items-center gap-3 rounded-2xl border border-sky-600/20 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <ReceiptText aria-hidden className="h-5 w-5 shrink-0" />
            <span className="flex-1"><b>{r.title}</b> · {r.status === "draft" ? t("receipt.statusDraft") : t("receipt.unclaimedCount", { n: r.unclaimed })}</span>
            <ChevronRight aria-hidden className="h-5 w-5" />
          </Link>
        ))}

        <div className="grid grid-cols-2 gap-2">
          {actions.map((a, i) => (
            <Link key={a.href} href={a.href} className={`${i === 0 ? "btn-primary col-span-2" : "btn-secondary"} justify-start`}><a.icon aria-hidden className="h-5 w-5" />{a.label}</Link>
          ))}
        </div>

        {expenses.length === 0 && active.length === 1 && <Notice title={t("group.aloneTitle")}>{t("group.aloneBody")} <Link className="font-semibold underline" href={`/groups/${id}?tab=members`}>{t("group.invite")}</Link></Notice>}
        {activity.length > 0 && (<div><h2 className="section-title !mt-2">{t("home.recent")}</h2><ActivityList rows={activity} /></div>)}
      </div>
    );
  }

  async function Expenses() {
    const all = await listExpenses(id, user.id, { includeDeleted: sp.deleted === "1" });
    const live = all.filter((e) => !e.deleted_at);
    const deleted = all.filter((e) => e.deleted_at);
    if (!all.length) return <Empty icon="🧾" title={t("expenses.emptyTitle")} body={t("expenses.emptyBody")}><Link href={`/groups/${id}/expenses/new`} className="btn-primary">{t("group.addExpense")}</Link></Empty>;
    return (
      <div className="grid gap-3">
        <ul className="card divide-y divide-paper-line p-0">
          {live.map((e) => (
            <li key={e.id}>
              <Link href={e.status === "draft" ? `/groups/${id}/expenses/${e.id}/edit` : `/groups/${id}/expenses/${e.id}`} className="flex items-center gap-3 px-4 py-3">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper text-lg">{CATEGORY_EMOJI[e.category as Category] ?? "🧾"}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="truncate font-semibold">{e.title}</span>{e.open_requests > 0 && <Badge tone="warn">{t("expenses.correction")}</Badge>}</span>
                  <span className="muted block truncate text-xs">{formatShortDate(e.expense_date)} · {e.status === "draft" ? t("expenses.draft") : t("expenses.paidBy", { name: e.payer_names.join(", ") })}</span>
                </span>
                <span className="text-right">
                  {e.status === "draft" ? <Badge tone="warn">{t("expenses.enterAmount")}</Badge> : (
                    <>
                      <span className="block font-bold">{formatMoney(e.amount_minor, e.currency)}</span>
                      <span className="muted block text-xs">{e.my_share > 0 ? t("expenses.yourShare", { amount: formatMoney(e.my_share, e.currency) }) : t("expenses.notIncluded")}</span>
                    </>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {sp.deleted === "1" ? (
          deleted.length > 0 && (
            <div>
              <h2 className="section-title">{t("expenses.deleted")}</h2>
              <ul className="card divide-y divide-paper-line p-0">
                {deleted.map((e) => (
                  <li key={e.id} className="row px-4 py-3">
                    <span className="min-w-0"><span className="block truncate font-semibold line-through">{e.title}</span><span className="muted text-xs">{formatMoney(e.amount_minor, e.currency)} · {formatShortDate(e.expense_date)}</span></span>
                    {!e.receipt_id && <ActButton action={restoreExpenseAction.bind(null, id, e.id)} label={t("expenses.restore")} />}
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <Link href={`/groups/${id}?tab=expenses&deleted=1`} className="btn-ghost btn-sm justify-self-start">{t("expenses.showDeleted")}</Link>
        )}
      </div>
    );
  }

  function Balances() {
    const any = balances.currencies.length > 0;
    return (
      <div className="grid gap-4">
        {!any && <Empty icon="⚖️" title={t("balances.emptyTitle")} body={t("balances.emptyBody")} />}
        {balances.currencies.map((c) => (
          <section key={c}>
            {balances.currencies.length > 1 && <h2 className="section-title !mt-0">{c} · {t(`currency.${c}` as "currency.TRY")}</h2>}
            <ul className="card divide-y divide-paper-line p-0">
              {members.filter((m) => m.status === "active" || (balances.nets[c][m.id] ?? 0) !== 0).map((m) => (
                <li key={m.id}>
                  <Link href={`/groups/${id}/balance/${m.id}`} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={m.display_name} size="sm" />
                    <span className="flex-1 truncate text-sm font-semibold">{m.display_name}{m.id === me.id && <span className="muted font-normal"> ({t("common.you")})</span>}{m.status === "left" && <span className="muted font-normal"> · {t("members.left")}</span>}</span>
                    <BalanceText net={balances.nets[c][m.id] ?? 0} currency={c} mine={m.id === me.id} className="text-sm" />
                    <ChevronRight aria-hidden className="h-4 w-4 text-ink-mute" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {any && (
          <section>
            <h2 className="section-title !mt-2">{t("balances.whoPaysWhom")}</h2>
            {balances.transfers.length === 0 ? <Notice tone="ok">{t("balance.settledLong")}</Notice> : (
              <ul className="grid gap-2">
                {balances.transfers.map((x, i) => {
                  const mineAs = x.from === myUnit ? "debtor" : x.to === myUnit ? "creditor" : me.role === "admin" ? "admin" : null;
                  return (
                    <li key={i} className="card grid gap-3">
                      <p className="text-sm"><b>{unitName(x.from)}</b> → <b>{unitName(x.to)}</b><span className="float-right text-base font-bold">{formatMoney(x.amount, x.currency)}</span></p>
                      {mineAs && <TransferActions groupId={id} groupName={group.name} transfer={x} fromName={unitName(x.from)} toName={unitName(x.to)} role={mineAs} debtorHasAccount={!!members.find((m) => m.id === x.from)?.user_id} />}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="muted mt-3 text-xs">{balances.simplified ? t("balances.simplifiedNote") : t("balances.pairwiseNote")} {t("balances.planNote")}</p>
          </section>
        )}
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
    if (!requests.length && !reports.length && !payments.length) return <Empty icon="🤝" title={t("payments.emptyTitle")} body={t("payments.emptyBody")}><Link className="btn-secondary" href={`/groups/${id}?tab=balances`}>{t("group.tab_balances")}</Link></Empty>;
    return (
      <div className="grid gap-4">
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
        <ul className="card divide-y divide-paper-line p-0">
          {active.map((m) => {
            const c = coupleOf(m.id);
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.display_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.display_name}{m.id === me.id && <span className="muted font-normal"> ({t("common.you")})</span>}</p>
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

        {canInvite ? (
          <section className="card grid gap-3">
            <h2>{t("members.inviteTitle")}</h2>
            <p className="muted">{t("members.inviteBody")}</p>
            <InvitePanel groupId={id} groupName={group.name} inviterName={me.display_name} activeLinks={invites.map((i) => ({ id: i.id, label: i.target_name ? t("members.linkFor", { name: i.target_name }) : t("members.linkGeneral"), meta: t("members.linkMeta", { date: formatDate(i.expires_at), n: i.use_count }) }))} canRevoke={me.role === "admin"} />
            <div className="border-t border-paper-line pt-3"><AddPlaceholder groupId={id} /></div>
          </section>
        ) : <Notice>{t("members.guestNote")} <Link className="font-semibold underline" href="/profile#secure">{t("home.secureTitle")}</Link></Notice>}

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
