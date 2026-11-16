"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Home, Plus, User, Users } from "lucide-react";
import { t } from "@/lib/i18n";

export function BottomNav({ unread, addHref }: { unread: number; addHref: string }) {
  const path = usePathname();
  // Form ekranlarında alt menü gizlenir; ekranın tek ana eylemi "Kaydet" düğmesidir.
  if (/\/expenses\/(new|[0-9a-f-]{36}\/edit)$/.test(path)) return null;
  const items = [
    { href: "/", label: t("nav.home"), icon: Home, on: path === "/" },
    { href: "/groups", label: t("nav.groups"), icon: Users, on: path.startsWith("/groups") },
    null,
    { href: "/activity", label: t("nav.activity"), icon: Activity, on: path.startsWith("/activity"), dot: unread > 0 },
    { href: "/profile", label: t("nav.profile"), icon: User, on: path.startsWith("/profile") || path.startsWith("/premium") },
  ];
  // Harcama Ekle, bulunulan grubu hedefler.
  const m = path.match(/^\/groups\/([0-9a-f-]{36})/);
  const add = m ? `/groups/${m[1]}/expenses/new` : addHref;
  return (
    <nav aria-label={t("nav.label")} className="fixed inset-x-0 bottom-0 z-30 px-3" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
      <ul className="mx-auto grid max-w-md grid-cols-5 items-end rounded-[1.6rem] bg-white/95 px-1 shadow-nav ring-1 ring-paper-line backdrop-blur">
        {items.map((it, i) =>
          it ? (
            <li key={it.href}>
              <Link href={it.href} aria-current={it.on ? "page" : undefined}
                className={`relative flex min-h-[62px] flex-col items-center justify-center gap-1 text-[11px] font-bold transition ${it.on ? "text-brand-700" : "text-ink-faint hover:text-ink-soft"}`}>
                <span className={`grid h-8 w-12 place-items-center rounded-full transition ${it.on ? "bg-brand-50" : ""}`}>
                  <it.icon aria-hidden className="h-[21px] w-[21px]" strokeWidth={it.on ? 2.5 : 2} />
                </span>
                {it.label}
                {it.dot && <span className="absolute right-[24%] top-2.5 h-2.5 w-2.5 rounded-full bg-warm-600 ring-2 ring-white"><span className="sr-only">{t("nav.unread")}</span></span>}
              </Link>
            </li>
          ) : (
            <li key={i} className="grid place-items-center">
              <Link href={add} aria-label={t("nav.add")}
                className="-mt-7 grid h-[62px] w-[62px] place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lift ring-[5px] ring-paper transition active:scale-95">
                <Plus aria-hidden className="h-7 w-7" strokeWidth={2.8} />
              </Link>
              <span className="mt-1 pb-2 text-[11px] font-bold text-brand-700">{t("nav.addShort")}</span>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
