import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { getExpense } from "@/server/expenses";
import { env } from "@/server/env";
import { ExpenseForm } from "@/components/expense-form";
import { Header, Page } from "@/components/ui";
import type { ExpenseInput } from "@/lib/expense-calc";
import type { Category } from "@/lib/categories";
import { todayISO } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata = { title: "Harcamayı düzenle" };

export default async function EditExpensePage({ params }: { params: Promise<{ id: string; eid: string }> }) {
  const { id, eid } = await params;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  const d = await getExpense(id, user.id, eid).catch(() => notFound());
  if (!d.canEdit || d.expense.deleted_at) redirect(`/groups/${id}/expenses/${eid}`);
  const e = d.expense;
  const input: ExpenseInput = {
    title: e.title, note: e.note, category: e.category as Category, amount: e.amount_minor, currency: e.currency, expenseDate: e.expense_date,
    payers: d.payers.map((p) => ({ memberId: p.member_id, amount: p.amount_minor })), split: e.split_meta,
    fx: e.original_currency && e.fx_rate ? { originalAmount: e.original_amount_minor!, originalCurrency: e.original_currency, rate: String(Number(e.fx_rate)).replace(".", ","), source: e.fx_source ?? "", date: e.fx_date ?? e.expense_date } : null,
    periodStart: e.period_start, periodEnd: e.period_end,
  };
  // Düzenlemede, harcamada adı geçen ayrılmış üyeler de listede kalır.
  const involved = new Set([...d.payers.map((p) => p.member_id), ...d.allocations.map((a) => a.member_id)]);
  const members = ctx.members.filter((m) => m.status === "active" || involved.has(m.id)).map((m) => ({ id: m.id, name: m.display_name }));
  return (
    <Page>
      <Header title={e.status === "draft" ? t("expense.fillDraft") : t("expense.editTitle")} back={`/groups/${id}${e.status === "draft" ? "" : `/expenses/${eid}`}`} subtitle={ctx.group.name} />
      <ExpenseForm groupId={id} groupType={ctx.group.type} groupCurrency={ctx.group.currency} meId={ctx.me.id} today={todayISO(user.timezone)} members={members} fxEnabled={env.fxProvider !== "manual"}
        initial={{ id: eid, version: e.version, isDraft: e.status === "draft", input }} />
    </Page>
  );
}
