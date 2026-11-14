import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/session";
import { listGroups } from "@/server/groups";
import { Empty, Header, Page } from "@/components/ui";
import { GROUP_EMOJI } from "@/lib/group-types";
import { t } from "@/lib/i18n";

export const metadata = { title: "Harcama ekle" };

export default async function AddPage() {
  const user = await requireUser("/add");
  const groups = (await listGroups(user.id)).filter((g) => !g.archived_at);
  if (groups.length === 1) redirect(`/groups/${groups[0].id}/expenses/new`);
  return (
    <Page>
      <Header title={t("add.title")} subtitle={groups.length ? t("add.pick") : undefined} />
      {groups.length === 0 ? (
        <Empty icon="🧾" title={t("add.emptyTitle")} body={t("add.emptyBody")}><Link href="/groups/new" className="btn-primary">{t("home.createFirst")}</Link></Empty>
      ) : (
        <ul className="grid gap-2">
          {groups.map((g) => (
            <li key={g.id}><Link href={`/groups/${g.id}/expenses/new`} className="card flex items-center gap-3 py-3">
              <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-xl">{GROUP_EMOJI[g.type]}</span>
              <span className="font-semibold">{g.name}</span>
            </Link></li>
          ))}
        </ul>
      )}
    </Page>
  );
}
