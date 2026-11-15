export const routes = {
  workspace: { title: "Sessions" },
  settings: { title: "General Settings" },
  providers: { title: "Providers & models" },
  agent: { title: "Agents" },
  schedules: { title: "Schedules" },
  remote: { title: "Remote access" },
  sources: { title: "Sources" },
  about: { title: "About" },
} as const;

export type Page = keyof typeof routes;

export function pageFromHash(hash: string): Page {
  const path = hash.replace(/^#\/?/, "");
  return Object.hasOwn(routes, path) ? (path as Page) : "workspace";
}
