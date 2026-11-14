import { tr } from "@/locales/tr";

/** Tek dil (tr) ile başlar. İngilizce eklemek için locales/en.ts oluşturup burada seçmek yeterlidir. */
type Dict = typeof tr;
type Leaves<T, P extends string = ""> = { [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`> }[keyof T & string];
export type TKey = Leaves<Dict>;

export function t(key: TKey, params?: Record<string, string | number>): string {
  let cur: unknown = tr;
  for (const part of key.split(".")) cur = (cur as Record<string, unknown>)?.[part];
  let s = typeof cur === "string" ? cur : key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
/** Dinamik anahtar (ör. hata kodu). Bulunamazsa yedek metni döndürür. */
export function tDyn(key: string, fallback: string, params?: Record<string, string | number>): string {
  const s = t(key as TKey, params);
  return s === key ? fallback : s;
}
