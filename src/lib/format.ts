const TZ = "Europe/Istanbul";
/** Tarihler UTC saklanır; kullanıcının saat diliminde, Türkiye biçimiyle gösterilir. */
export function formatDate(d: Date | string, tz = TZ): string {
  // "YYYY-AA-GG" takvim tarihleri saat dilimi kaymasına uğramasın.
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  }
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(new Date(d));
}
export function formatShortDate(d: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
}
export function formatDateTime(d: Date | string, tz = TZ): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(d));
}
export function todayISO(tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}
export const firstName = (n: string) => n.trim().split(/\s+/)[0];
