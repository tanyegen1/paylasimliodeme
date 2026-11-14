import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { ocrStatus } from "@/server/providers/ai";
import { ReceiptEditor } from "@/components/receipt-editor";
import { Header, Page } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { t } from "@/lib/i18n";

export const metadata = { title: "Fiş paylaş" };

export default async function NewReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  return (
    <Page>
      <Header title={t("receipt.newTitle")} back={`/groups/${id}`} subtitle={t("receipt.newLead")} />
      <ReceiptEditor groupId={id} meId={ctx.me.id} groupCurrency={ctx.group.currency} today={todayISO(user.timezone)} ocr={ocrStatus()}
        members={ctx.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.display_name }))} />
    </Page>
  );
}
