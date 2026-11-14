import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { getExpense } from "@/server/expenses";
import { signedFileUrl } from "@/server/storage";
import { Avatar, Badge, Header, Notice, Page } from "@/components/ui";
import { ActButton } from "@/components/client";
import { deleteExpenseAction, resolveCommentAction, restoreExpenseAction, reopenReceiptAction } from "@/app/actions";
import { CATEGORY_EMOJI, type Category } from "@/lib/categories";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { t, tDyn } from "@/lib/i18n";
import { CommentForm } from "./comment";

export const metadata = { title: "Harcama" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  const d = await getExpense(id, user.id, eid).catch(() => notFound());
  const e = d.expense;
  const name = (mid: string | null) => ctx.members.find((m) => m.id === mid)?.display_name ?? t("activity.system");
  const fileUrl = e.attachment_id ? await signedFileUrl(id, user.id, e.attachment_id).catch(() => null) : null;
  const sm = e.split_meta as { type: string; items?: { name: string; amount: number; claims: { memberId: string }[] }[]; discount?: number; service?: number; tip?: number; parts?: { memberId: string; bps?: number; weight?: number }[] };
  return (
    <Page>
      <Header title={e.title} back={`/groups/${id}?tab=expenses`} subtitle={`${CATEGORY_EMOJI[e.category as Category] ?? ""} ${tDyn(`category.${e.category}`, e.category)} · ${formatDate(e.expense_date)}`} />
      {e.deleted_at && <div className="mb-3 grid gap-2"><Notice tone="warn">{t("expenseDetail.deleted")}</Notice>{!e.receipt_id && d.canEdit && <ActButton action={restoreExpenseAction.bind(null, id, eid)} label={t("expenses.restore")} className="btn-primary" />}</div>}
      <section className="card">
        <p className="text-3xl font-extrabold">{formatMoney(e.amount_minor, e.currency)}</p>
        {e.original_currency && e.original_amount_minor != null && (
          <p className="muted mt-1">{t("expenseDetail.fx", { original: formatMoney(e.original_amount_minor, e.original_currency), rate: String(Number(e.fx_rate)).replace(".", ","), source: e.fx_source ?? "", date: e.fx_date ? formatDate(e.fx_date) : "" })}</p>
        )}
        {e.period_start && e.period_end && <p className="muted mt-1">{t("expenseDetail.period", { from: formatDate(e.period_start), to: formatDate(e.period_end) })}</p>}
        {e.note && <p className="mt-3 whitespace-pre-line rounded-xl bg-paper px-3 py-2 text-sm">{e.note}</p>}
        {fileUrl && <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm mt-3">{t("expenseDetail.file")}</a>}
        <h2 className="section-title">{t("expense.paidBy")}</h2>
        <ul className="grid gap-1.5">{d.payers.map((p) => <li key={p.member_id} className="row text-sm"><span className="flex items-center gap-2"><Avatar name={name(p.member_id)} size="sm" />{name(p.member_id)}</span><b>{formatMoney(p.amount_minor, e.currency)}</b></li>)}</ul>
        <h2 className="section-title">{t("expenseDetail.shares")} · {t(`split.${e.split_type}` as "split.equal")}</h2>
        <ul className="grid gap-1.5">
          {d.allocations.map((a) => {
            const part = sm.parts?.find((p) => p.memberId === a.member_id);
            return (
              <li key={a.member_id} className="row text-sm">
                <span className="flex items-center gap-2"><Avatar name={name(a.member_id)} size="sm" />{name(a.member_id)}{a.member_id === d.me.id && <span className="muted">({t("common.you")})</span>}
                  {part?.bps != null && <span className="muted">%{String(part.bps / 100).replace(".", ",")}</span>}{part?.weight != null && <span className="muted">×{part.weight}</span>}</span>
                <b>{formatMoney(a.amount_minor, e.currency)}{a.rounding_minor !== 0 && <sup> *</sup>}</b>
              </li>
            );
          })}
        </ul>
        {d.allocations.some((a) => a.rounding_minor !== 0) && <p className="muted mt-2 text-xs">* {t("expense.roundingNote")}</p>}
        {sm.type === "itemized" && sm.items && (
          <>
            <h2 className="section-title">{t("expenseDetail.items")}</h2>
            <ul className="grid gap-1.5 text-sm">
              {sm.items.map((it, i) => <li key={i}><div className="row"><span>{it.name}</span><b>{formatMoney(it.amount, e.currency)}</b></div><p className="muted text-xs">{it.claims.map((c) => name(c.memberId)).join(", ")}</p></li>)}
              {!!sm.discount && <li className="row"><span>{t("expense.discount")}</span><b>−{formatMoney(sm.discount, e.currency)}</b></li>}
              {!!sm.service && <li className="row"><span>{t("expense.service")}</span><b>{formatMoney(sm.service, e.currency)}</b></li>}
              {!!sm.tip && <li className="row"><span>{t("expense.tip")}</span><b>{formatMoney(sm.tip, e.currency)}</b></li>}
            </ul>
          </>
        )}
      </section>

      {!e.deleted_at && (
        <div className="mt-3 flex flex-wrap gap-2">
          {d.canEdit && <Link href={`/groups/${id}/expenses/${eid}/edit`} className="btn-secondary flex-1">{t("common.edit")}</Link>}
          {d.canEdit && <ActButton action={deleteExpenseAction.bind(null, id, eid)} label={t("common.delete")} className="btn-danger" confirm={t("expenseDetail.deleteConfirm")} href={`/groups/${id}?tab=expenses`} />}
          {e.receipt_id && <Link href={`/groups/${id}/receipts/${e.receipt_id}`} className="btn-secondary flex-1">{t("expenseDetail.receipt")}</Link>}
          {e.receipt_id && (d.me.role === "admin" || e.created_by === d.me.id) && <ActButton action={reopenReceiptAction.bind(null, id, e.receipt_id)} label={t("receipt.reopen")} className="btn-secondary" confirm={t("receipt.reopenConfirm")} href={`/groups/${id}/receipts/${e.receipt_id}`} />}
        </div>
      )}
      {!d.canEdit && !e.receipt_id && <p className="muted mt-2 text-xs">{t("expenseDetail.guestNote")}</p>}

      <h2 className="section-title">{t("expenseDetail.comments")}</h2>
      {d.comments.length > 0 && (
        <ul className="mb-3 grid gap-2">
          {d.comments.map((c) => (
            <li key={c.id} className="card py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2"><b>{name(c.member_id)}</b>{c.kind === "correction_request" && <Badge tone={c.status === "open" ? "warn" : "ok"}>{c.status === "open" ? t("expenseDetail.correctionOpen") : t("expenseDetail.correctionResolved")}</Badge>}<span className="muted text-xs">{formatDateTime(c.created_at)}</span></p>
              <p className="mt-1 whitespace-pre-line">{c.body}</p>
              {c.kind === "correction_request" && c.status === "open" && (c.member_id === d.me.id || e.created_by === d.me.id || d.me.role === "admin") && <div className="mt-2"><ActButton action={resolveCommentAction.bind(null, id, c.id)} label={t("expenseDetail.resolve")} /></div>}
            </li>
          ))}
        </ul>
      )}
      <CommentForm groupId={id} expenseId={eid} />

      <h2 className="section-title">{t("expenseDetail.history")}</h2>
      <ul className="card grid gap-2 text-sm">
        {d.history.map((h) => {
          const b = (h.data as { before?: { amount_minor?: number; currency?: string }; after?: { amount_minor?: number; currency?: string } });
          return (
            <li key={h.id}>
              <span>{tDyn(`history.${h.type.replace(/\./g, "_")}`, h.type, { actor: name(h.actor_member_id) })}</span>
              {b.before && b.after && b.before.amount_minor !== b.after.amount_minor && <span className="muted"> · {formatMoney(b.before.amount_minor ?? 0, b.before.currency)} → {formatMoney(b.after.amount_minor ?? 0, b.after.currency)}</span>}
              <span className="muted block text-xs">{formatDateTime(h.created_at)}</span>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
