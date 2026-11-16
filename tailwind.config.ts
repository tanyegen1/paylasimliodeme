import type { Config } from "tailwindcss";

/**
 * Renk sistemi (3 katman):
 *  - brand: zümrüt/turkuaz vurgu (az piksel, ana eylemler)
 *  - ink/paper: lacivert tonlu nötrler (arayüzün çoğu)
 *  - warm/danger/sky: anlamsal destek renkleri (borç, hata, bilgi) — her zaman metinle birlikte
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0F1F33", soft: "#3E4C5E", mute: "#647186", faint: "#94A0B2" },
        paper: { DEFAULT: "#F3F6F4", card: "#FFFFFF", line: "#E3E9E5", sunk: "#EDF2EF" },
        brand: {
          50: "#E7F7F1", 100: "#C8EEDF", 200: "#9FDFC8", 300: "#6CCBAC", 400: "#36B38F",
          500: "#12997A", 600: "#0B8466", 700: "#086B53", 800: "#075442", 900: "#063F33",
        },
        warm: { 50: "#FFF4E5", 100: "#FFE3BF", 200: "#FFD39A", 600: "#B25E09", 700: "#8F4A06" },
        danger: { 50: "#FDECEC", 600: "#B3261E" },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.25rem", "3xl": "1.75rem" },
      boxShadow: {
        card: "0 1px 2px rgba(15,31,51,.04), 0 6px 20px -8px rgba(15,31,51,.10)",
        lift: "0 10px 30px -10px rgba(11,132,102,.45)",
        nav: "0 -1px 0 rgba(15,31,51,.04), 0 -8px 30px -12px rgba(15,31,51,.18)",
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
