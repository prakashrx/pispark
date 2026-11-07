/**
 * Appearance catalog. Colors live in themes.css as `[data-theme]` blocks;
 * this file only names them and supplies preview swatches for the picker.
 */
export type ThemeMode = "light" | "dark";

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  description: string;
  /** Picker preview only: [surface, sidebar, text, accent]. */
  swatch: [string, string, string, string];
}

export const themes: Theme[] = [
  {
    id: "daylight",
    name: "Daylight",
    mode: "light",
    description: "Clean white, indigo accent",
    swatch: ["#ffffff", "#f9f9f9", "#0d0d0d", "#4f46e5"],
  },
  {
    id: "paper",
    name: "Paper",
    mode: "light",
    description: "Warm cream, terracotta accent",
    swatch: ["#fdfcf9", "#f6f3ec", "#1a1612", "#c2410c"],
  },
  {
    id: "mist",
    name: "Mist",
    mode: "light",
    description: "Cool slate, teal accent",
    swatch: ["#fcfdff", "#f3f6fb", "#0b1120", "#0f766e"],
  },
  {
    id: "midnight",
    name: "Midnight",
    mode: "dark",
    description: "Soft charcoal, indigo accent",
    swatch: ["#212121", "#171717", "#f5f5f5", "#6366f1"],
  },
  {
    id: "ocean",
    name: "Ocean",
    mode: "dark",
    description: "Deep navy, cyan accent",
    swatch: ["#0f1724", "#0b121d", "#f1f5fa", "#22d3ee"],
  },
  {
    id: "ember",
    name: "Ember",
    mode: "dark",
    description: "Warm espresso, amber accent",
    swatch: ["#1c1917", "#161311", "#f7f4f0", "#fb923c"],
  },
];

/** "system" follows the OS color scheme between these two. */
export const systemThemes: Record<ThemeMode, string> = {
  light: "daylight",
  dark: "midnight",
};

export interface FontChoice {
  id: string;
  name: string;
  stack: string;
}

const sansStack =
  '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif';

export const fonts: FontChoice[] = [
  { id: "sans", name: "Sans", stack: sansStack },
  {
    id: "system",
    name: "System",
    stack:
      'system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, Ubuntu, sans-serif',
  },
  {
    id: "humanist",
    name: "Humanist",
    stack:
      'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
  },
  {
    id: "serif",
    name: "Serif",
    stack:
      '"Iowan Old Style", Charter, "Sitka Text", Cambria, Georgia, "Times New Roman", serif',
  },
  {
    id: "mono",
    name: "Mono",
    stack:
      '"JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, ui-monospace, monospace',
  },
];

export interface TextSize {
  id: string;
  name: string;
  /** Root font size; every rem-based size and spacing scales with it. */
  px: number;
}

export const textSizes: TextSize[] = [
  { id: "compact", name: "Compact", px: 15 },
  { id: "default", name: "Default", px: 16 },
  { id: "large", name: "Large", px: 17 },
  { id: "xlarge", name: "Extra large", px: 18 },
];
