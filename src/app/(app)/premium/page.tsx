import { requireUser } from "@/server/session";
import { userPlan } from "@/server/entitlements";
import { PLANS } from "@/config/plans";
import { Badge, Header, Notice, Page } from "@/components/ui";
import { t } from "@/lib/i18n";

export const metadata = { title: "Premium" };

export default async function PremiumPage() {
  const user = await requireUser("/premium");
  const plan = await userPlan(user.id);
  const rows: [string, string, string][] = [
    [t("premium.fOcr"), t("premium.perMonth", { n: PLANS.free.ocrScansPerMonth }), t("premium.perMonth", { n: PLANS.premium.ocrScansPerMonth })],
    [t("premium.fNl"), t("premium.perMonth", { n: PLANS.free.nlDraftsPerMonth }), t("premium.perMonth", { n: PLANS.premium.nlDraftsPerMonth })],
    [t("premium.fReports"), "—", "✓"], [t("premium.fExport"), "—", "✓"],
  ];
  return (
    <Page>
      <Header title={t("premium.title")} back="/profile" action={<Badge tone={plan === "premium" ? "ok" : "neutral"}>{plan === "premium" ? t("premium.active") : t("premium.free")}</Badge>} />
      <Notice tone="ok" title={t("premium.freeTitle")}>{t("premium.freeBody")}</Notice>
      <div className="card mt-4 overflow-x-auto p-0"><table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-mute"><th className="px-4 py-2 font-semibold">{t("premium.feature")}</th><th className="px-2 py-2 font-semibold">{t("premium.free")}</th><th className="px-4 py-2 font-semibold">Premium</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-paper-line"><td className="px-4 py-2.5">{r[0]}</td><td className="px-2 py-2.5">{r[1]}</td><td className="px-4 py-2.5 font-semibold">{r[2]}</td></tr>)}</tbody>
      </table></div>
      <section className="card mt-4"><h2>{t("premium.groupTitle")}</h2><p className="muted mt-1">{t("premium.groupBody")}</p></section>
      <section className="card mt-4"><h2>{t("premium.feesTitle")}</h2><p className="muted mt-1">{t("premium.feesBody")}</p></section>
      <div className="mt-4"><Notice tone="warn" title={t("premium.notYetTitle")}>{t("premium.notYetBody")}</Notice></div>
      <button className="btn-primary mt-4 w-full" disabled aria-disabled>{t("premium.cta")}</button>
    </Page>
  );
}
