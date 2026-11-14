import Link from "next/link";
import { t } from "@/lib/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-xl place-items-center px-5 text-center">
      <div><p aria-hidden className="text-5xl">🧭</p><h1 className="mt-3">{t("notFound.title")}</h1><p className="muted mt-2">{t("notFound.body")}</p><Link href="/" className="btn-primary mt-5">{t("join.home")}</Link></div>
    </main>
  );
}
