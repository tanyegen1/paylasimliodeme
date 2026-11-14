import "server-only";
import { env } from "./env";

/**
 * Kur önerisi. Varsayılan: manual (kullanıcı kuru kendisi girer).
 * FX_PROVIDER=tcmb ise TCMB'nin herkese açık günlük kur XML'inden döviz satış kuru önerilir.
 * Her durumda kur, kullanıcı ONAYLADIĞI değerle ve kaynağı/tarihiyle harcamaya kaydedilir.
 */
export async function suggestRate(from: string, to: string): Promise<{ rate: string; source: string; date: string } | null> {
  if (env.fxProvider !== "tcmb" || to !== "TRY" || from === "TRY") return null;
  try {
    const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", { signal: AbortSignal.timeout(4000), next: { revalidate: 3600 } } as RequestInit);
    if (!res.ok) return null;
    const xml = await res.text();
    const date = xml.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
    const block = xml.match(new RegExp(`<Currency[^>]*CurrencyCode="${from}"[\\s\\S]*?</Currency>`));
    const rate = block?.[0].match(/<ForexSelling>([\d.]+)<\/ForexSelling>/)?.[1];
    if (!rate || !date) return null;
    return { rate, source: "TCMB döviz satış", date: `${date[3]}-${date[2]}-${date[1]}` };
  } catch {
    return null;
  }
}
