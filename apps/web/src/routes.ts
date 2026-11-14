export const routes = {
  workspace: { title: "Chats" },
  settings: { title: "General Settings" },
  providers: { title: "Providers & models" },
  persona: { title: "Personas" },
  schedules: { title: "Schedules" },
  sources: { title: "Sources" },
  about: { title: "About" },
} as const;

export type Page = keyof typeof routes;

export function pageFromHash(hash: string): Page {
  const path = hash.replace(/^#\/?/, "");
  return Object.hasOwn(routes, path) ? (path as Page) : "workspace";
}
