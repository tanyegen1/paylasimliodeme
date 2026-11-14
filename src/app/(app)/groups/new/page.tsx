import { requireUser } from "@/server/session";
import { Header, Page } from "@/components/ui";
import { t } from "@/lib/i18n";
import { NewGroupForm } from "./form";

export const metadata = { title: "Yeni grup" };

export default async function NewGroupPage() {
  const user = await requireUser("/groups/new");
  return (
    <Page>
      <Header title={t("newGroup.title")} back="/groups" />
      <NewGroupForm inviterName={user.display_name} />
    </Page>
  );
}
