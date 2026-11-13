import type { IconName } from "../../lib/ui/icons";
import type { Page } from "../../routes";
export const settingsLinks: { label: string; icon: IconName; page?: Page }[] = [
  { label: "General", icon: "general", page: "settings" },
  { label: "Providers & models", icon: "providers", page: "providers" },
  { label: "Personas", icon: "people", page: "persona" },
  { label: "Schedules", icon: "clock", page: "schedules" },
  { label: "Sources", icon: "settingsFolder", page: "sources" },
  { label: "Channels", icon: "channels" },
  { label: "Keybindings & Shortcuts", icon: "shortcuts" },
];
