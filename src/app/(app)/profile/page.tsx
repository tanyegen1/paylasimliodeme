import Link from "next/link";
import { requireUser } from "@/server/session";
import { getPrefs } from "@/server/auth";
import { userPlan, usage } from "@/server/entitlements";
import { PLANS } from "@/config/plans";
import { Badge, Header, Page } from "@/components/ui";
import { logoutAction } from "@/app/actions";
import { brand } from "@/config/brand";
import { t } from "@/lib/i18n";
import { DangerZone, PasswordForm, PrefsForm, ProfileForm, SecureForm } from "./forms";

export const metadata = { title: "Profil" };

export default async function ProfilePage() {
  const user = await requireUser("/profile");
  const [prefs, plan, used] = await Promise.all([getPrefs(user.id), userPlan(user.id), usage(user.id)]);
  return (
    <Page>
      <Header title={t("profile.title")} action={user.is_demo ? <Badge tone="warn">DEMO</Badge> : undefined} />
      {user.is_guest && (
        <section id="secure" className="mb-4 rounded-2xl border border-brand-600/25 bg-brand-50 p-4">
          <h2 className="text-brand-800">{t("profile.secureTitle")}</h2>
          <p className="mt-1 text-sm text-brand-800">{t("profile.secureBody")}</p>
          <SecureForm />
        </section>
      )}
      <section className="card"><h2 className="mb-3">{t("profile.account")}</h2>
        {!user.is_guest && <p className="muted mb-3">{user.email}</p>}
        <ProfileForm initial={{ name: user.display_name, iban: user.iban ?? "", ibanHolder: user.iban_holder ?? "", marketing: user.marketing_opt_in }} />
      </section>
      <section className="card mt-4"><h2 className="mb-1">{t("profile.notifications")}</h2><p className="muted mb-3">{t("profile.notificationsBody")}</p><PrefsForm initial={prefs} /></section>
      <section className="card mt-4">
        <div className="row"><h2>{t("premium.title")}</h2><Badge tone={plan === "premium" ? "ok" : "neutral"}>{plan === "premium" ? t("premium.active") : t("premium.free")}</Badge></div>
        <p className="muted mt-1">{t("profile.usage", { ocr: used.ocr ?? 0, ocrMax: PLANS[plan].ocrScansPerMonth, nl: used.nl ?? 0, nlMax: PLANS[plan].nlDraftsPerMonth })}</p>
        <Link href="/premium" className="btn-secondary btn-sm mt-3">{t("premium.learn")}</Link>
      </section>
      {!user.is_guest && <section className="card mt-4"><h2 className="mb-3">{t("profile.security")}</h2><PasswordForm /></section>}
      <section className="card mt-4"><h2 className="mb-1">{t("profile.data")}</h2><p className="muted mb-3">{t("profile.dataBody")}</p>
        <a href="/api/account-export" className="btn-secondary btn-sm">{t("profile.export")}</a>
        <DangerZone />
      </section>
      <form action={logoutAction} className="mt-4"><button className="btn-secondary w-full">{t("profile.logout")}</button></form>
      {user.is_guest && <p className="muted mt-2 text-xs">{t("profile.logoutGuestWarn")}</p>}
      <p className="muted mt-6 flex flex-wrap gap-3 text-xs"><Link className="underline" href="/legal/privacy">{t("legal.privacy")}</Link><Link className="underline" href="/legal/terms">{t("legal.terms")}</Link><Link className="underline" href="/legal/kvkk">{t("legal.kvkk")}</Link><span>{brand.name}</span></p>
    </Page>
  );
}
