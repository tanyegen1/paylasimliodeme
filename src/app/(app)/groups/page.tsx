import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { requireUser } from "@/server/session";
import { getHomeSummary } from "@/server/ledger";
import { BalanceText, Empty, Header, Page, Badge } from "@/components/ui";
import { GROUP_EMOJI } from "@/lib/group-types";
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
        <ul className="grid gap-2">
          {groups.map((g) => {
            const nets = Object.entries(perGroup[g.id] ?? {});
            return (
              <li key={g.id}>
                <Link href={`/groups/${g.id}`} className={`card flex items-center gap-3 py-3 ${g.archived_at ? "opacity-60" : ""}`}>
                  <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-xl">{GROUP_EMOJI[g.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2"><span className="truncate font-semibold">{g.name}</span>{g.archived_at && <Badge>{t("groups.archived")}</Badge>}{g.is_demo && <Badge tone="warn">DEMO</Badge>}</span>
                    <span className="muted block">{t(`groupType.${g.type}`)} · {t("groups.members", { n: g.member_count })}</span>
                    <span className="block text-sm">{nets.length === 0 ? <span className="text-ink-mute">{t("balance.settled")}</span> : nets.map(([c, v]) => <BalanceText key={c} net={v} currency={c} className="mr-2" />)}</span>
                  </span>
                  <ChevronRight aria-hidden className="h-5 w-5 text-ink-mute" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
