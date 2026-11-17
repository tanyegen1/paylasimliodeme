import type { Config } from "tailwindcss";

/** Renkler src/config/themes.ts içindeki temalardan CSS değişkeni olarak gelir. */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

/**
 * Renk sistemi (3 katman, her tema için aynı roller):
 *  - brand: zümrüt/turkuaz vurgu (az piksel, ana eylemler)
 *  - ink/paper: lacivert tonlu nötrler (arayüzün çoğu)
 *  - warm/danger/sky: anlamsal destek renkleri (borç, hata, bilgi) — her zaman metinle birlikte
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: v("ink"), soft: v("ink-soft"), mute: v("ink-mute"), faint: v("ink-faint") },
        paper: { DEFAULT: v("paper"), card: v("paper-card"), line: v("paper-line"), sunk: v("paper-sunk") },
        brand: Object.fromEntries(["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map((k) => [k, v(`brand-${k}`)])),
        warm: { 50: v("warm-50"), 100: v("warm-100"), 200: v("warm-200"), 600: v("warm-600"), 700: v("warm-700") },
        danger: { 50: v("danger-50"), 600: v("danger-600") },
        sky: { 50: v("sky-50"), 100: v("sky-100"), 700: v("sky-700"), 800: v("sky-800"), 900: v("sky-900") },
        violet: { 50: v("violet-50"), 700: v("violet-700") },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.25rem", "3xl": "1.75rem" },
      boxShadow: {
        card: "0 1px 2px rgb(0 0 0 / .04), 0 6px 20px -8px rgb(0 0 0 / .12)",
        lift: "0 10px 30px -10px rgb(var(--brand-600) / .45)",
        nav: "0 -1px 0 rgb(0 0 0 / .04), 0 -8px 30px -12px rgb(0 0 0 / .25)",
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        pop: { "0%": { transform: "scale(.6)", opacity: "0" }, "60%": { transform: "scale(1.08)", opacity: "1" }, "100%": { transform: "scale(1)" } },
        confetti: { "0%": { transform: "translate(0,0) rotate(0)", opacity: "1" }, "100%": { transform: "translate(var(--x), var(--y)) rotate(var(--r))", opacity: "0" } },
      },
      animation: {
        rise: "rise .28s ease-out backwards",
        pop: "pop .4s cubic-bezier(.2,.9,.3,1.2) both",
        confetti: "confetti .9s ease-out forwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
