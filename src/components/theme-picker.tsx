"use client";

import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { DEFAULT_THEME, THEMES, THEME_COOKIE, THEME_OPTIONS, isThemeId, themeChrome, type Theme, type ThemeId } from "@/config/themes";
import { Sheet } from "@/components/client";
import { t } from "@/lib/i18n";

function readTheme(): ThemeId {
  const v = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  return isThemeId(v) ? v : DEFAULT_THEME;
}
/** Temayı hemen uygular ve bu cihazda bir yıl hatırlar (çerez: sunucu da ilk açılışta doğru temayı çizer). */
export function applyTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeChrome(id));
}

/** Seçeneğin kendi renkleriyle çizilen küçük ekran önizlemesi (mevcut temadan bağımsız). */
function Preview({ th, half }: { th: Theme; half?: Theme }) {
  const box = (x: Theme, clip?: string) => (
    <span className="absolute inset-0 p-2" style={{ background: x.paper.DEFAULT, clipPath: clip }}>
      <span className="block h-7 rounded-lg" style={{ background: `linear-gradient(135deg, ${x.hero[0]}, ${x.hero[1]} 55%, ${x.hero[2]})` }} />
      <span className="mt-1.5 flex items-center gap-1 rounded-md px-1.5 py-1" style={{ background: x.paper.card }}>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: x.brand[300] }} />
        <span className="h-1.5 flex-1 rounded-full" style={{ background: x.ink.faint, opacity: 0.5 }} />
      </span>
      <span className="mt-1.5 block h-3 rounded-md" style={{ background: x.brand[600] }} />
    </span>
  );
  return (
    <span aria-hidden className="relative block h-[88px] overflow-hidden rounded-xl ring-1 ring-black/5">
      {box(th)}
      {half && box(half, "polygon(100% 0, 100% 100%, 0 100%)")}
    </span>
  );
}

export function ThemePicker({ onPicked }: { onPicked?: () => void }) {
  const [current, setCurrent] = useState<ThemeId>(DEFAULT_THEME);
  useEffect(() => setCurrent(readTheme()), []);
  const byId = Object.fromEntries(THEMES.map((th) => [th.id, th])) as Record<string, Theme>;
  return (
    <div role="radiogroup" aria-label={t("theme.title")} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {THEME_OPTIONS.map((o) => {
        const on = current === o.id;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on}
            onClick={() => { applyTheme(o.id); setCurrent(o.id); onPicked?.(); }}
            className={`relative rounded-2xl bg-paper-card p-2 text-left transition active:scale-[0.97] ${on ? "ring-2 ring-brand-500" : "ring-1 ring-paper-line hover:ring-brand-200"}`}>
            {o.id === "auto" ? <Preview th={byId.emerald} half={byId.night} /> : <Preview th={byId[o.id]} />}
            <span className="mt-2 flex items-center justify-between gap-1 px-1 pb-0.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{t(`theme.${o.id}`)}</span>
                <span className="block truncate text-[11px] text-ink-mute">{t(`theme.${o.id}_hint`)}</span>
              </span>
              {on && <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white"><Check aria-hidden className="h-4 w-4" strokeWidth={3} /></span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Üst köşedeki palet düğmesi: tema seçiciyi alttan açılan pencerede gösterir. */
export function ThemeButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t("theme.title")}
        className="grid h-11 w-11 place-items-center rounded-full bg-paper-card text-ink-soft shadow-card ring-1 ring-paper-line transition active:scale-95">
        <Palette aria-hidden className="h-5 w-5" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("theme.title")}>
        <ThemePicker />
        <p className="muted mt-4 text-xs">{t("theme.note")}</p>
      </Sheet>
    </>
  );
}
