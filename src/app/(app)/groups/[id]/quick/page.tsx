import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { nlpStatus } from "@/server/providers/ai";
import { Header, Page } from "@/components/ui";
import { t } from "@/lib/i18n";
import { QuickAdd } from "./quick";

export const metadata = { title: "Yazarak ekle" };

export default async function QuickPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  return (
    <Page>
      <Header title={t("quick.title")} back={`/groups/${id}`} subtitle={ctx.group.name} />
      <QuickAdd groupId={id} provider={nlpStatus()} members={ctx.members.map((m) => ({ id: m.id, name: m.display_name }))} />
    </Page>
  );
}
