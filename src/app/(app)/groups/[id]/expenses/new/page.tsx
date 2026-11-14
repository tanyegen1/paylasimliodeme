import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageSquareText, ReceiptText } from "lucide-react";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { env } from "@/server/env";
import { ExpenseForm } from "@/components/expense-form";
import { Header, Page } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata = { title: "Harcama ekle" };

export default async function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/groups/${id}/expenses/new`);
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  return (
    <Page>
      <Header title={t("expense.newTitle")} back={`/groups/${id}`} subtitle={ctx.group.name} />
      <div className="mb-5 grid grid-cols-2 gap-2">
        <Link href={`/groups/${id}/quick`} className="btn-secondary btn-sm"><MessageSquareText aria-hidden className="h-4 w-4" />{t("group.quickAdd")}</Link>
        <Link href={`/groups/${id}/receipts/new`} className="btn-secondary btn-sm"><ReceiptText aria-hidden className="h-4 w-4" />{t("group.shareReceipt")}</Link>
      </div>
      <ExpenseForm groupId={id} groupType={ctx.group.type} groupCurrency={ctx.group.currency} meId={ctx.me.id} today={todayISO(user.timezone)} fxEnabled={env.fxProvider !== "manual"}
        members={ctx.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.display_name }))} />
    </Page>
  );
}
