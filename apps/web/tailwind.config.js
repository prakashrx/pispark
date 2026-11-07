import forms from "@tailwindcss/forms";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{svelte,ts}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        /* Semantic design tokens — reference var(--token) so themes just override :root */
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },
        interactive: { DEFAULT: "var(--interactive)", foreground: "var(--interactive-foreground)", muted: "var(--interactive-muted)" },
        sidebar: { DEFAULT: "var(--sidebar)", foreground: "var(--sidebar-foreground)", border: "var(--sidebar-border)", accent: "var(--sidebar-accent)" },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        /* Keep zinc for existing code */
        brand: { 50: "#f4f6f8", 100: "#e5e7eb", 500: "#10b981", 900: "#111827" },
      },
      boxShadow: {
        "elevation-sm":
          "0 1px 2px 0 rgba(0,0,0,0.03), 0 1px 3px 0 rgba(0,0,0,0.05)",
        "elevation-md":
          "0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -2px rgba(0,0,0,0.04)",
        "elevation-lg":
          "0 10px 25px -5px rgba(0,0,0,0.07), 0 8px 10px -6px rgba(0,0,0,0.05)",
      },
    },
  },
  plugins: [forms],
};
