/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', "system-ui", "-apple-system", "sans-serif"],
        display: ['"Nunito"', '"DM Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
        },
        accent: {
          400: "#34d399",
          500: "#059669",
          600: "#047857",
        },
        void: {
          DEFAULT: "rgb(3 3 4 / <alpha-value>)",
          soft: "rgb(6 6 10 / <alpha-value>)",
          panel: "rgb(10 10 16 / <alpha-value>)",
        },
        irid: {
          cyan: "rgb(34 211 238 / <alpha-value>)",
          violet: "rgb(167 139 250 / <alpha-value>)",
          pink: "rgb(244 114 182 / <alpha-value>)",
          blue: "rgb(96 165 250 / <alpha-value>)",
          teal: "rgb(45 212 191 / <alpha-value>)",
          pearl: "#e2e8f0",
        },
      },
      backgroundImage: {
        iridescent:
          "linear-gradient(135deg, rgba(34,211,238,0.55) 0%, rgba(167,139,250,0.5) 38%, rgba(244,114,182,0.45) 68%, rgba(96,165,250,0.5) 100%)",
        "iridescent-soft":
          "linear-gradient(135deg, rgba(34,211,238,0.22) 0%, rgba(167,139,250,0.2) 40%, rgba(244,114,182,0.18) 70%, rgba(96,165,250,0.22) 100%)",
        "iridescent-btn":
          "radial-gradient(circle 180px at 78% 50%, rgb(103 232 249 / 0.92), transparent 78%), radial-gradient(circle 160px at 16% 50%, rgb(251 113 133 / 0.9), transparent 78%), #4c1d95",
        "iridescent-text":
          "linear-gradient(120deg, #67e8f9 0%, #c4b5fd 35%, #f9a8d4 65%, #93c5fd 100%)",
      },
      boxShadow: {
        panel:
          "0 0 0.5px rgba(167, 139, 250, 0.14), 0 0 1px rgba(34, 211, 238, 0.1), 0 0 2px rgba(167, 139, 250, 0.08), 0 0 4px rgba(167, 139, 250, 0.065), 0 0 8px rgba(34, 211, 238, 0.05), 0 0 16px rgba(244, 114, 182, 0.04), 0 0 32px rgba(167, 139, 250, 0.03), 0 0 48px rgba(34, 211, 238, 0.02)",
        "panel-hover":
          "0 0 0.5px rgba(167, 139, 250, 0.22), 0 0 1px rgba(34, 211, 238, 0.16), 0 0 2px rgba(167, 139, 250, 0.12), 0 0 4px rgba(167, 139, 250, 0.1), 0 0 8px rgba(34, 211, 238, 0.08), 0 0 16px rgba(244, 114, 182, 0.06), 0 0 32px rgba(167, 139, 250, 0.045), 0 0 56px rgba(34, 211, 238, 0.03)",
        glow:
          "0 0 0.5px rgba(167, 139, 250, 0.18), 0 0 1px rgba(34, 211, 238, 0.14), 0 0 2px rgba(167, 139, 250, 0.11), 0 0 4px rgba(167, 139, 250, 0.09), 0 0 8px rgba(34, 211, 238, 0.07), 0 0 16px rgba(244, 114, 182, 0.055), 0 0 32px rgba(167, 139, 250, 0.04), 0 0 64px rgba(34, 211, 238, 0.025)",
        "glow-sm":
          "0 0 0.5px rgba(167, 139, 250, 0.14), 0 0 1px rgba(34, 211, 238, 0.1), 0 0 2px rgba(167, 139, 250, 0.08), 0 0 4px rgba(167, 139, 250, 0.065), 0 0 8px rgba(34, 211, 238, 0.05), 0 0 16px rgba(244, 114, 182, 0.04), 0 0 32px rgba(167, 139, 250, 0.03)",
        "glow-xs":
          "0 0 0.5px rgba(167, 139, 250, 0.12), 0 0 1px rgba(34, 211, 238, 0.08), 0 0 2px rgba(167, 139, 250, 0.06), 0 0 4px rgba(167, 139, 250, 0.045), 0 0 8px rgba(244, 114, 182, 0.03)",
        "glow-md":
          "0 0 0.5px rgba(167, 139, 250, 0.2), 0 0 1px rgba(34, 211, 238, 0.15), 0 0 2px rgba(167, 139, 250, 0.12), 0 0 4px rgba(167, 139, 250, 0.1), 0 0 8px rgba(34, 211, 238, 0.08), 0 0 16px rgba(244, 114, 182, 0.06), 0 0 32px rgba(167, 139, 250, 0.045), 0 0 56px rgba(34, 211, 238, 0.03), 0 0 80px rgba(244, 114, 182, 0.02)",
        "glow-lg":
          "0 0 0.5px rgba(167, 139, 250, 0.24), 0 0 1px rgba(34, 211, 238, 0.18), 0 0 2px rgba(167, 139, 250, 0.14), 0 0 4px rgba(167, 139, 250, 0.11), 0 0 8px rgba(34, 211, 238, 0.09), 0 0 16px rgba(244, 114, 182, 0.07), 0 0 32px rgba(167, 139, 250, 0.05), 0 0 64px rgba(34, 211, 238, 0.035), 0 0 96px rgba(244, 114, 182, 0.02)",
        "glow-inset":
          "inset 0 0 0 1px rgba(167, 139, 250, 0.07), inset 0 0 1px rgba(34, 211, 238, 0.05), inset 0 0 2px rgba(167, 139, 250, 0.04), inset 0 0 4px rgba(244, 114, 182, 0.035), inset 0 0 8px rgba(167, 139, 250, 0.025), inset 0 0 16px rgba(34, 211, 238, 0.018), inset 0 0 32px rgba(3, 3, 4, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.025)",
        "glow-green":
          "0 0 1px rgba(52, 211, 153, 0.3), 0 0 2px rgba(52, 211, 153, 0.2), 0 0 4px rgba(52, 211, 153, 0.12), 0 0 8px rgba(5, 150, 105, 0.08), 0 0 16px rgba(52, 211, 153, 0.05)",
        "glow-amber":
          "0 0 1px rgba(251, 191, 36, 0.3), 0 0 2px rgba(251, 191, 36, 0.2), 0 0 4px rgba(251, 191, 36, 0.12), 0 0 8px rgba(251, 191, 36, 0.07), 0 0 16px rgba(251, 191, 36, 0.04)",
        "glow-red":
          "0 0 1px rgba(248, 113, 113, 0.28), 0 0 2px rgba(248, 113, 113, 0.18), 0 0 4px rgba(248, 113, 113, 0.1), 0 0 8px rgba(248, 113, 113, 0.06), 0 0 16px rgba(248, 113, 113, 0.035)",
      },
      transitionDuration: {
        DEFAULT: "200ms",
      },
    },
  },
  plugins: [],
};
