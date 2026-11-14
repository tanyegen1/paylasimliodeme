import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#12233f", soft: "#44536d", mute: "#6b7890" },
        paper: { DEFAULT: "#f7f8f5", card: "#ffffff", line: "#e3e7e1" },
        brand: { 50: "#e8f7f1", 100: "#c9eddf", 500: "#0f9d76", 600: "#0b8262", 700: "#086a50", 800: "#07513e" },
        warm: { 50: "#fdf3e7", 600: "#a85a12", 700: "#8a480c" },
        danger: { 50: "#fdecec", 600: "#b3261e" },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      boxShadow: { card: "0 1px 2px rgba(18,35,63,.05), 0 4px 16px rgba(18,35,63,.04)" },
    },
  },
  plugins: [],
} satisfies Config;
