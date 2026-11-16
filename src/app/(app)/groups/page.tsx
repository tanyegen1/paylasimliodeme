import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUser } from "@/server/session";
import { getHomeSummary } from "@/server/ledger";
import { Empty, Header, Page } from "@/components/ui";
import { GroupCard } from "@/components/group-card";
import { t } from "@/lib/i18n";

export const metadata = { title: "Gruplar" };

export default async function GroupsPage() {
  const user = await requireUser();
  const { groups, perGroup } = await getHomeSummary(user.id);
  return (
    <Page>
      <Header title={t("groups.title")} action={<Link href="/groups/new" className="btn-primary btn-sm"><Plus aria-hidden className="h-4 w-4" />{t("groups.new")}</Link>} />
      {groups.length === 0 ? (
        <Empty icon="👥" title={t("home.emptyTitle")} body={t("home.emptyBody")}><Link href="/groups/new" className="btn-primary">{t("home.createFirst")}</Link></Empty>
      ) : (
        <ul className="grid gap-2.5">
          {groups.map((g) => <li key={g.id}><GroupCard g={g} nets={perGroup[g.id] ?? {}} /></li>)}
        </ul>
      )}
    </Page>
  );
}
