/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          1: "#0D1117",
          2: "#111820",
          3: "#0A0F15",
        },
        accent: {
          DEFAULT: "#B8D4E3",
          hover: "#A0C4D8",
          glow: "rgba(184, 212, 227, 0.38)",
          muted: "rgba(184, 212, 227, 0.15)",
        },
        "surface-dark": {
          DEFAULT: "#050507",
          secondary: "#0E0E10",
          tertiary: "#161618",
          elevated: "#1C1C1E",
        },
        "surface-light": {
          DEFAULT: "#FAF8F5",
          secondary: "#F5F0EB",
          tertiary: "#EDE8E3",
        },
        island: {
          bg: "#000000",
          glow: "rgba(184, 212, 227, 0.31)",
        },
      },
      fontFamily: {
        display: ["'Fraunces Variable'", "Fraunces", "Georgia", "serif"],
        body: ["'Geist Sans'", "'Helvetica Neue'", "sans-serif"],
        mono: ["'JetBrains Mono Variable'", "'JetBrains Mono'", "'SF Mono'", "Consolas", "monospace"],
      },
      backdropBlur: {
        glass: "20px",
      },
      boxShadow: {
        "island-glow": "0 0 20px rgba(184, 212, 227, 0.31), 0 4px 12px rgba(0, 0, 0, 0.38)",
        "float-ball": "0 0 18px rgba(184, 212, 227, 0.31), 0 4px 10px rgba(0, 0, 0, 0.5)",
        card: "0 0 15px rgba(92, 88, 85, 0.1)",
        elevated: "0 20px 60px rgba(0, 0, 0, 0.7)",
      },
    },
  },
  plugins: [],
};
