export const routes = {
  workspace: { title: "Chats" },
  settings: { title: "General Settings" },
  providers: { title: "Providers & models" },
  persona: { title: "Personas" },
  sources: { title: "Sources" },
} as const;

export type Page = keyof typeof routes;

export function pageFromHash(hash: string): Page {
  const path = hash.replace(/^#\/?/, "");
  return Object.hasOwn(routes, path) ? (path as Page) : "workspace";
}
