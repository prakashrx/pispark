import { fonts, systemThemes, textSizes, themes } from "./themes";

/**
 * Browser-local presentation preference. It never leaves this browser and is
 * not part of backend configuration.
 */
export interface Appearance {
  theme: string; // a theme id or "system"
  interfaceFont: string;
  messageFont: string;
  textSize: string;
}

const key = "pispark.appearance";
export const defaultAppearance: Appearance = {
  theme: "system",
  interfaceFont: "sans",
  messageFont: "sans",
  textSize: "default",
};

function valid(value: Partial<Appearance>): Appearance {
  const pick = <T extends { id: string }>(list: T[], id: unknown, fallback: string) =>
    list.some((item) => item.id === id) ? (id as string) : fallback;
  return {
    theme:
      value.theme === "system"
        ? "system"
        : pick(themes, value.theme, defaultAppearance.theme),
    interfaceFont: pick(fonts, value.interfaceFont, defaultAppearance.interfaceFont),
    messageFont: pick(fonts, value.messageFont, defaultAppearance.messageFont),
    textSize: pick(textSizes, value.textSize, defaultAppearance.textSize),
  };
}

function load(): Appearance {
  try {
    return valid(JSON.parse(localStorage.getItem(key) ?? "{}"));
  } catch {
    return { ...defaultAppearance };
  }
}

const darkQuery =
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;

class AppearanceState {
  current = $state<Appearance>(load());
  systemDark = $state(darkQuery?.matches ?? false);

  /** The concrete theme id in effect, resolving "system". */
  get resolvedTheme(): string {
    return this.current.theme === "system"
      ? systemThemes[this.systemDark ? "dark" : "light"]
      : this.current.theme;
  }

  constructor() {
    darkQuery?.addEventListener?.("change", (event) => {
      this.systemDark = event.matches;
      this.apply();
    });
  }

  set(change: Partial<Appearance>) {
    this.current = valid({ ...this.current, ...change });
    try {
      localStorage.setItem(key, JSON.stringify(this.current));
    } catch {
      // Storage may be unavailable (private mode); the choice still applies now.
    }
    this.apply();
  }

  apply() {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const theme = themes.find((t) => t.id === this.resolvedTheme) ?? themes[0]!;
    root.dataset.theme = theme.id;
    root.style.colorScheme = theme.mode;
    const font = (id: string) => fonts.find((f) => f.id === id)?.stack ?? fonts[0]!.stack;
    root.style.setProperty("--font-sans", font(this.current.interfaceFont));
    root.style.setProperty("--font-reading", font(this.current.messageFont));
    root.style.fontSize = `${textSizes.find((s) => s.id === this.current.textSize)?.px ?? 16}px`;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme.swatch[0]);
  }
}

export const appearance = new AppearanceState();
