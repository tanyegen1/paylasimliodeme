import { notFound } from "next/navigation";
import { requireUser } from "@/server/session";
import { getGroupContext } from "@/server/groups";
import { listRules } from "@/server/recurring";
import { Header, Notice, Page } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { t } from "@/lib/i18n";
import { RuleForm, RuleRow } from "./rules";

export const metadata = { title: "Tekrarlayan giderler" };

export default async function RecurringPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await getGroupContext(id, user.id).catch(() => notFound());
  const rules = await listRules(id, user.id);
  const members = ctx.members.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.display_name }));
  const can = ctx.me.role !== "guest";
  return (
    <Page>
      <Header title={t("recurring.title")} back={`/groups/${id}`} subtitle={t("recurring.lead")} />
      {rules.length > 0 && <ul className="mb-5 grid gap-2">{rules.map((r) => <RuleRow key={r.id} groupId={id} rule={r} members={members} canEdit={can} />)}</ul>}
      {can ? <RuleForm groupId={id} members={members} meId={ctx.me.id} today={todayISO(user.timezone)} currency={ctx.group.currency} /> : <Notice>{t("members.guestNote")}</Notice>}
      <p className="muted mt-4 text-xs">{t("recurring.note")}</p>
    </Page>
  );
}
