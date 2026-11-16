import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser, safeNext } from "@/server/session";
import { env } from "@/server/env";
import { q } from "@/server/db";
import { brand } from "@/config/brand";
import { t } from "@/lib/i18n";
import { AuthForms } from "./forms";

export const metadata = { title: "Giriş" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getUser()) redirect(next);
  const demoUsers = env.demoMode ? await q<{ id: string; display_name: string }>(`select id, display_name from users where is_demo and deleted_at is null order by created_at limit 6`) : [];
  return (
    <main className="rise mx-auto max-w-xl px-5 pb-16 pt-8">
      <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-brand-700"><span aria-hidden className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-sm text-white">₺</span>{brand.name}</Link>
      <AuthForms next={next} initial={sp.mode === "start" ? "start" : sp.mode === "register" ? "register" : "login"} demoUsers={demoUsers} />
      <p className="muted mt-8 text-xs">{t("auth.legalNote")} <Link className="underline" href="/legal/terms">{t("legal.terms")}</Link> · <Link className="underline" href="/legal/privacy">{t("legal.privacy")}</Link> · <Link className="underline" href="/legal/kvkk">{t("legal.kvkk")}</Link></p>
    </main>
  );
}
