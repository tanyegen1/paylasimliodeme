import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { getReceipt } from "@/server/receipts";
import { ocrStatus } from "@/server/providers/ai";
import { ReceiptEditor } from "@/components/receipt-editor";
import { Header, Notice, Page } from "@/components/ui";
import { minorToInput } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ClaimBoard } from "./claims";

export const metadata = { title: "Fiş" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const user = await requireUser(`/groups/${id}/receipts/${rid}`);
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  const r = await getReceipt(id, user.id, rid).catch(() => notFound());
  const members = ctx.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.display_name }));
  const rc = r.receipt;
  if (rc.status === "draft") {
    if (!r.canManage) return <Page><Header title={rc.title} back={`/groups/${id}`} /><Notice>{t("receipt.draftOthers")}</Notice></Page>;
    return (
      <Page>
        <Header title={t("receipt.editTitle")} back={`/groups/${id}`} subtitle={rc.title} />
        <ReceiptEditor groupId={id} meId={ctx.me.id} groupCurrency={ctx.group.currency} today={todayISO(user.timezone)} ocr={ocrStatus()} members={members}
          initial={{ id: rid, title: rc.title, payerMemberId: rc.payer_member_id, currency: rc.currency, expenseDate: rc.expense_date, extrasMode: rc.extras_mode,
            declaredTotal: rc.declared_total_minor != null ? minorToInput(rc.declared_total_minor) : "", discount: rc.discount_minor ? minorToInput(rc.discount_minor) : "", service: rc.service_minor ? minorToInput(rc.service_minor) : "", tip: rc.tip_minor ? minorToInput(rc.tip_minor) : "",
            items: r.items.map((i) => ({ id: i.id, name: i.name, quantity: String(Number(i.quantity)).replace(".", ","), amount: minorToInput(i.amount_minor), uncertain: i.uncertain })) }} />
      </Page>
    );
  }
  return (
    <Page>
      <Header title={rc.title} back={`/groups/${id}`} subtitle={rc.status === "finalized" ? t("receipt.statusFinal") : t("receipt.claimLead")} />
      {rc.status === "finalized" && rc.expense_id && <div className="mb-3 grid gap-2"><Notice tone="ok">{t("receipt.finalNote")}</Notice><Link className="btn-secondary" href={`/groups/${id}/expenses/${rc.expense_id}`}>{t("receipt.viewExpense")}</Link></div>}
      <ClaimBoard groupId={id} receiptId={rid} meId={ctx.me.id} members={members} canManage={r.canManage} status={rc.status} currency={rc.currency}
        items={r.items.map((i) => ({ id: i.id, name: i.name, quantity: Number(i.quantity), amount: i.amount_minor, uncertain: i.uncertain, claims: i.claims.map((c) => c.memberId) }))}
        totals={{ items: r.itemsTotal, discount: rc.discount_minor, service: rc.service_minor, tip: rc.tip_minor, total: r.computed, extrasMode: rc.extras_mode }}
        preview={r.preview} payerName={members.find((m) => m.id === rc.payer_member_id)?.name ?? "?"} />
    </Page>
  );
}
