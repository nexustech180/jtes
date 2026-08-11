import type { Config } from "tailwindcss";

// Brand tokens carried over from the legacy site (legacy-site/index.html :root
// variables) so the new build matches existing JTES brand colors exactly.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          dark: "#0A0F1E",
          dark2: "#0F172A",
          navy: "#1E3A8A",
          blue: "#2563EB",
          "blue-dark": "#1D4ED8",
          "blue-light": "#3B82F6",
        },
        ink: {
          DEFAULT: "#1e293b",
          muted: "#64748b",
        },
        surface: {
          light: "#f8fafc",
          border: "#e2e8f0",
        },
      },
    },
  },
  plugins: [],
};

export default config;
