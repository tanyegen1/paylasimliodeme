/**
 * Para: her zaman para biriminin en küçük biriminde (kuruş, cent) TAM SAYI.
 * Kayan noktalı aritmetik kullanılmaz; ayrıştırma metin üzerinden yapılır.
 */
export const CURRENCIES = {
  TRY: { symbol: "₺", name: "Türk lirası", decimals: 2 },
  EUR: { symbol: "€", name: "Euro", decimals: 2 },
  USD: { symbol: "$", name: "ABD doları", decimals: 2 },
  GBP: { symbol: "£", name: "İngiliz sterlini", decimals: 2 },
} as const;
export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];
export const isCurrency = (c: string): c is Currency => c in CURRENCIES;

/** En fazla ~90 trilyon kuruş; JS güvenli tam sayı aralığının çok altında tutulur. */
export const MAX_MINOR = 1_000_000_000_00;

/** 124050 → "₺1.240,50" */
export function formatMoney(minor: number, currency: string = "TRY", opts: { sign?: boolean } = {}): string {
  const cur = CURRENCIES[currency as Currency] ?? { symbol: currency + " ", decimals: 2 };
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const s = `${cur.symbol}${grouped},${frac}`;
  if (neg) return `−${s}`;
  return opts.sign && minor > 0 ? `+${s}` : s;
}

/**
 * Türkçe yazımı kuruşa çevirir: "1.240,50" → 124050, "1240" → 124000, "12,5" → 1250.
 * Tek noktalı ve 1-2 haneli kesirli yazım ("12.50") ondalık sayılır; "1.240" binlik sayılır.
 * Geçersizse null.
 */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/[₺€$£\s]|TL|tl/g, "");
  if (!s || !/^\d[\d.,]*$/.test(s)) return null;
  let whole: string;
  let frac = "";
  if (s.includes(",")) {
    const parts = s.split(",");
    if (parts.length !== 2) return null;
    whole = parts[0].replace(/\./g, "");
    frac = parts[1];
  } else if ((s.match(/\./g) ?? []).length === 1 && /\.\d{1,2}$/.test(s)) {
    [whole, frac] = s.split(".");
  } else {
    if (s.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(s)) return null;
    whole = s.replace(/\./g, "");
  }
  if (frac.length > 2 || !/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return null;
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0") || 0);
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return null;
  return minor;
}

/** Form alanında gösterim: 124050 → "1240,50" */
export function minorToInput(minor: number): string {
  const abs = Math.abs(minor);
  return `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Kur çevirimi. Kur ondalık METİN olarak verilir ("41,2530" veya "41.2530"), 6 haneye kadar.
 * Sonuç BigInt ile hesaplanır, yarım yukarı yuvarlanır.
 */
export function parseRate(input: string): bigint | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,6})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const micro = BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"));
  return micro > 0n ? micro : null;
}
export function convertMinor(amountMinor: number, rate: string): number | null {
  const micro = parseRate(rate);
  if (micro === null) return null;
  const out = (BigInt(amountMinor) * micro + 500_000n) / 1_000_000n;
  const n = Number(out);
  return Number.isSafeInteger(n) && n <= MAX_MINOR ? n : null;
}
