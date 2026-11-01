export const routes = {
  workspace: { title: "Workspace review" },
  settings: { title: "General Settings" },
  persona: { title: "Developer Persona" },
  sources: { title: "Sources" },
} as const;

export type Page = keyof typeof routes;

export function pageFromHash(hash: string): Page {
  const path = hash.replace(/^#\/?/, "");
  return Object.hasOwn(routes, path) ? (path as Page) : "workspace";
}
