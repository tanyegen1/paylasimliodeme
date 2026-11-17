import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { brand } from "@/config/brand";
import { DEFAULT_THEME, THEME_COOKIE, isThemeId, themeChrome, themeCss } from "@/config/themes";
import { env } from "@/server/env";
import { t } from "@/lib/i18n";

export const metadata: Metadata = {
  title: { default: `${brand.name} · ${brand.tagline}`, template: `%s · ${brand.name}` },
  description: brand.description,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: brand.name, statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

async function currentTheme() {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return isThemeId(v) ? v : DEFAULT_THEME;
}
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: themeChrome(await currentTheme()), width: "device-width", initialScale: 1, viewportFit: "cover" };
}

const CSS = themeCss();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tema sunucuda çerezden okunur: sayfa ilk açılışta doğru renkte gelir, renk "yanıp sönmez".
  const theme = await currentTheme();
  return (
    <html lang="tr" data-theme={theme}>
      <head>
        <style id="pz-themes" dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body className="font-sans">
        {env.demoMode && (
          <div role="status" className="bg-warm-50 px-4 py-1.5 text-center text-xs font-semibold text-warm-700">{t("demo.banner")}</div>
        )}
        {children}
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}` }} />
      </body>
    </html>
  );
}
