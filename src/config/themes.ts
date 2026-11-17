/**
 * Arayüz temaları. Tüm renkler buradan gelir; Tailwind sınıfları (bg-brand-600, text-ink…)
 * CSS değişkenlerine bağlıdır, tema değişince yeniden derleme gerekmez.
 *
 * Kurallar:
 *  - brand-600: beyaz yazılı ana düğme zemini → beyazla kontrast ≥ 4.5:1
 *  - brand-700/800: açık zemin (brand-50) üzerinde metin
 *  - warm: "Borcun" vurgusu, danger: hata. Anlam hiçbir zaman yalnızca renkle verilmez.
 */
type Scale = Record<"50" | "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900", string>;
export type Theme = {
  id: string;
  dark: boolean;
  ink: { DEFAULT: string; soft: string; mute: string; faint: string };
  paper: { DEFAULT: string; card: string; line: string; sunk: string };
  brand: Scale;
  warm: { 50: string; 100: string; 200: string; 600: string; 700: string };
  danger: { 50: string; 600: string };
  sky: { 50: string; 100: string; 700: string; 800: string; 900: string };
  violet: { 50: string; 700: string };
  hero: [string, string, string];
  /** Tarayıcı çubuğu rengi */
  chrome: string;
};

const lightBase = {
  dark: false,
  ink: { DEFAULT: "#0F1F33", soft: "#3E4C5E", mute: "#5F6C80", faint: "#7B8799" },
  warm: { 50: "#FFF4E5", 100: "#FFE3BF", 200: "#FFD39A", 600: "#B25E09", 700: "#8F4A06" },
  danger: { 50: "#FDECEC", 600: "#B3261E" },
  sky: { 50: "#F0F9FF", 100: "#E0F2FE", 700: "#0369A1", 800: "#075985", 900: "#0C4A6E" },
  violet: { 50: "#F5F3FF", 700: "#6D28D9" },
};

export const THEMES: Theme[] = [
  {
    ...lightBase, id: "emerald", chrome: "#0B8466",
    paper: { DEFAULT: "#F3F6F4", card: "#FFFFFF", line: "#E3E9E5", sunk: "#EBF0ED" },
    brand: { 50: "#E7F7F1", 100: "#C8EEDF", 200: "#9FDFC8", 300: "#6CCBAC", 400: "#36B38F", 500: "#12997A", 600: "#0B8466", 700: "#086B53", 800: "#075442", 900: "#063F33" },
    hero: ["#12997A", "#0B6E5A", "#0F2A44"],
  },
  {
    ...lightBase, id: "sky", chrome: "#1663C2",
    paper: { DEFAULT: "#F2F6FB", card: "#FFFFFF", line: "#DFE7F1", sunk: "#E8EFF8" },
    brand: { 50: "#EAF4FF", 100: "#D3E7FF", 200: "#A9D0FF", 300: "#75B3FA", 400: "#4294EF", 500: "#1F78DB", 600: "#1663C2", 700: "#124F9C", 800: "#10427E", 900: "#0E3765" },
    hero: ["#3B95F2", "#1663C2", "#0F2A4A"],
  },
  {
    ...lightBase, id: "lavender", chrome: "#6842CF",
    paper: { DEFAULT: "#F6F4FB", card: "#FFFFFF", line: "#E5E0F1", sunk: "#EEEAF7" },
    brand: { 50: "#F4F0FF", 100: "#E7DEFF", 200: "#D2C1FF", 300: "#B59BFB", 400: "#9774F2", 500: "#7C55E6", 600: "#6842CF", 700: "#5634AB", 800: "#462B8A", 900: "#3A256F" },
    hero: ["#9474F2", "#6842CF", "#241A4A"],
  },
  {
    ...lightBase, id: "coral", chrome: "#C2442A",
    paper: { DEFAULT: "#FBF5F2", card: "#FFFFFF", line: "#EDE1DA", sunk: "#F5ECE7" },
    brand: { 50: "#FFF1EC", 100: "#FFDFD3", 200: "#FFC0A9", 300: "#FC9876", 400: "#F57650", 500: "#E65A35", 600: "#C2442A", 700: "#A53A23", 800: "#86311F", 900: "#6E2A1C" },
    // Mercan temasında "borç" vurgusu kahverengiye kayar ki marka rengiyle karışmasın.
    warm: { 50: "#F6F0E3", 100: "#EBDFC2", 200: "#F4D9A0", 600: "#8A5A10", 700: "#6E470B" },
    hero: ["#E05A37", "#C2442A", "#3B1E2A"],
  },
  {
    id: "night", dark: true, chrome: "#0B141D",
    ink: { DEFAULT: "#E8EEF5", soft: "#BAC6D4", mute: "#94A2B4", faint: "#6F7E92" },
    paper: { DEFAULT: "#0B141D", card: "#15212D", line: "#253444", sunk: "#1B2937" },
    // Koyu temada 50–200 zemin tonları koyu, 700–900 metin tonları açıktır.
    brand: { 50: "#0F2E28", 100: "#143F36", 200: "#1C5647", 300: "#2E8A6F", 400: "#3CC49F", 500: "#19A783", 600: "#0B8466", 700: "#6FDDB9", 800: "#A2EDD3", 900: "#C9F6E6" },
    warm: { 50: "#3A2611", 100: "#4D3214", 200: "#F5C27A", 600: "#F0A955", 700: "#F6BE78" },
    danger: { 50: "#3B1517", 600: "#FF8A80" },
    sky: { 50: "#10263D", 100: "#17324F", 700: "#8CC4FF", 800: "#A9D3FF", 900: "#C7E2FF" },
    violet: { 50: "#261B44", 700: "#C3AEFF" },
    hero: ["#13A07F", "#0B5A4A", "#0A1824"],
  },
];

/** Seçicide gösterilen seçenekler. "auto" cihazın açık/koyu ayarını izler. */
export const THEME_OPTIONS = [
  { id: "emerald", swatch: ["#0B8466", "#F3F6F4"] },
  { id: "night", swatch: ["#13A07F", "#0B141D"] },
  { id: "sky", swatch: ["#1663C2", "#F2F6FB"] },
  { id: "lavender", swatch: ["#6842CF", "#F6F4FB"] },
  { id: "coral", swatch: ["#C2442A", "#FBF5F2"] },
  { id: "auto", swatch: ["#0B8466", "#0B141D"] },
] as const;
export type ThemeId = (typeof THEME_OPTIONS)[number]["id"];
export const DEFAULT_THEME: ThemeId = "emerald";
export const THEME_COOKIE = "pz_theme";
export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && THEME_OPTIONS.some((o) => o.id === v);

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
function vars(th: Theme): string {
  const out: string[] = [`color-scheme:${th.dark ? "dark" : "light"}`];
  const add = (prefix: string, obj: Record<string, string>) => {
    for (const [k, v] of Object.entries(obj)) out.push(`--${prefix}${k === "DEFAULT" ? "" : "-" + k}:${rgb(v)}`);
  };
  add("ink", th.ink); add("paper", th.paper); add("brand", th.brand); add("warm", th.warm);
  add("danger", th.danger); add("sky", th.sky); add("violet", th.violet);
  out.push(`--hero:radial-gradient(120% 140% at 100% 0%, ${th.hero[0]} 0%, ${th.hero[1]} 38%, ${th.hero[2]} 100%)`);
  return out.join(";");
}

/** Kök düzene gömülen CSS: her tema bir [data-theme] seçicisi. */
export function themeCss(): string {
  const byId = Object.fromEntries(THEMES.map((th) => [th.id, th]));
  const css = THEMES.map((th) => `:root[data-theme="${th.id}"]{${vars(th)}}`);
  css.unshift(`:root{${vars(byId.emerald)}}`);
  css.push(`:root[data-theme="auto"]{${vars(byId.emerald)}}`);
  css.push(`@media (prefers-color-scheme: dark){:root[data-theme="auto"]{${vars(byId.night)}}}`);
  return css.join("\n");
}
export const themeChrome = (id: ThemeId) => (id === "auto" ? "#0B8466" : THEMES.find((th) => th.id === id)!.chrome);
