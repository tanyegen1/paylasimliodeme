"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Home, Plus, User, Users } from "lucide-react";
import { t } from "@/lib/i18n";

export function BottomNav({ unread, addHref }: { unread: number; addHref: string }) {
  const path = usePathname();
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
    <nav aria-label={t("nav.label")} className="fixed inset-x-0 bottom-0 z-30 border-t border-paper-line bg-white/95 backdrop-blur" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto grid max-w-xl grid-cols-5 items-end px-1">
        {items.map((it, i) =>
          it ? (
            <li key={it.href}>
              <Link href={it.href} aria-current={it.on ? "page" : undefined}
                className={`relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${it.on ? "text-brand-700" : "text-ink-mute"}`}>
                <it.icon aria-hidden className="h-[22px] w-[22px]" strokeWidth={it.on ? 2.4 : 2} />
                {it.label}
                {it.dot && <span className="absolute right-[26%] top-2.5 h-2 w-2 rounded-full bg-warm-600"><span className="sr-only">{t("nav.unread")}</span></span>}
              </Link>
            </li>
          ) : (
            <li key={i} className="grid place-items-center">
              <Link href={add} aria-label={t("nav.add")} className="-mt-6 grid h-[60px] w-[60px] place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-700/30 ring-4 ring-paper transition-colors hover:bg-brand-700">
                <Plus aria-hidden className="h-7 w-7" strokeWidth={2.6} />
              </Link>
              <span className="mt-0.5 pb-1.5 text-[11px] font-semibold text-brand-700">{t("nav.addShort")}</span>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
