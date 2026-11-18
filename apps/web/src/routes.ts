/**
 * Screens have an address; dialogs, menus and sheets don't (design language §3.4). The address
 * is the hash, so a reload, the browser's back and a shared link land in the same place.
 */
export const settingsSections = {
  appearance: { label: "Appearance", hint: "Theme, text size, fonts" },
  providers: { label: "Providers & models", hint: "Sign-ins and the default model" },
  notifications: { label: "Notifications", hint: "On this device, when a session needs you" },
  remote: { label: "Remote access", hint: "Your phone and other devices" },
  about: { label: "About", hint: "Version and updates" },
} as const;
export type SettingsSection = keyof typeof settingsSections;

/** What a session's side panel shows: its Details, or one of the views opened from them. */
const detailsViews = ["details", "routines", "agent", "tasks", "file"] as const;
export type DetailsView = (typeof detailsViews)[number];

export type Route =
  | { name: "home" }
  | { name: "new" }
  /** `panel`: a session's Details as their own screen (compact); wider, the side panel opens on it. */
  | { name: "session"; id: string; panel?: DetailsView }
  | { name: "archived" }
  /** Without an id, the list of agents; with one, that agent's editor. */
  | { name: "agents"; id?: string }
  | { name: "background" }
  /** Without a section: the list of sections on compact, General elsewhere. */
  | { name: "settings"; section?: SettingsSection };

const isSection = (value: string | undefined): value is SettingsSection =>
  !!value && Object.hasOwn(settingsSections, value);
/** Addresses from before a section was renamed still land on it. */
const renamed: Record<string, SettingsSection> = { general: "appearance" };

const isView = (value: string | undefined): value is DetailsView => detailsViews.includes(value as DetailsView);

export function parseRoute(hash: string): Route {
  const [first, second, third, fourth] = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  switch (first) {
    case "new":
    case "archived":
    case "background":
      return { name: first };
    case "agents":
      return second ? { name: "agents", id: second } : { name: "agents" };
    case "s":
      if (!second) return { name: "home" };
      if (third !== "details") return { name: "session", id: second };
      return { name: "session", id: second, panel: isView(fourth) ? fourth : "details" };
    case "settings":
      if (second && Object.hasOwn(renamed, second)) return { name: "settings", section: renamed[second]! };
      return isSection(second) ? { name: "settings", section: second } : { name: "settings" };
    default:
      return { name: "home" };
  }
}

/** The address of a route, as a link's `href`. */
export function href(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "session": {
      const session = `#/s/${encodeURIComponent(route.id)}`;
      if (!route.panel) return session;
      return route.panel === "details" ? `${session}/details` : `${session}/details/${route.panel}`;
    }
    case "settings":
      return route.section ? `#/settings/${route.section}` : "#/settings";
    case "agents":
      return route.id ? `#/agents/${encodeURIComponent(route.id)}` : "#/agents";
    default:
      return `#/${route.name}`;
  }
}

/** Goes to a screen, as following a link would. */
export function go(route: Route) {
  window.location.hash = href(route).slice(1);
}

/** The tab's title for a route; a session's own name is added by the session screen. */
export function routeTitle(route: Route): string {
  switch (route.name) {
    case "home":
    case "new":
      return "New session";
    case "session":
      return "Session";
    case "archived":
      return "Archived";
    case "agents":
      return "Agents";
    case "background":
      return "Background";
    case "settings":
      return route.section ? settingsSections[route.section].label : "Settings";
  }
}
