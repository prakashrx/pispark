import forms from "@tailwindcss/forms";

const ramp = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
    step,
    `rgb(var(--n-${step}) / <alpha-value>)`,
  ]),
);

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        /* Semantic design tokens — reference var(--token) so themes just override :root */
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        subtle: "var(--subtle-foreground)",
        bubble: "var(--bubble)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        interactive: { DEFAULT: "var(--interactive)", foreground: "var(--interactive-foreground)", muted: "var(--interactive-muted)", text: "var(--interactive-text)" },
        sidebar: { DEFAULT: "var(--sidebar)", foreground: "var(--sidebar-foreground)", border: "var(--sidebar-border)", accent: "var(--sidebar-accent)" },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        /* Legacy neutral utilities follow the active theme's ramp. */
        white: "rgb(var(--n-0) / <alpha-value>)",
        zinc: ramp,
        gray: ramp,
        neutral: ramp,
        slate: ramp,
        stone: ramp,
      },
      boxShadow: {
        "elevation-sm": "var(--shadow-sm)",
        "elevation-md": "var(--shadow-composer)",
        "elevation-lg": "var(--shadow-popover)",
      },
    },
  },
  plugins: [forms],
};
