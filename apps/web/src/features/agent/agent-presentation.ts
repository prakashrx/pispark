const messages: Record<string, string> = {
  "invalid-input": "That request wasn’t valid.",
  "invalid-path": "That file name isn’t allowed.",
  "invalid-definition": "That agent setting isn’t valid.",
  "revision-conflict": "This changed somewhere else. The latest version is shown; try again.",
  "missing-resource": "That resource is no longer available.",
  "missing-parent": "An agent this one builds on is missing",
  cycle: "Agents can’t build on each other in a loop",
  "in-use": "Another agent builds on this one",
  "built-in": "That comes with PiSpark: it can’t be changed or deleted.",
  exists: "There’s already one with that name.",
  "not-found": "Not found.",
  limit: "That’s too large.",
  folder: "That folder doesn’t exist on the server.",
  storage: "Couldn’t read or save on the server.",
};

/** Plain-language agent errors; details are agent IDs, never file contents. */
export function agentError(code: string, detail?: string): string {
  const message = messages[code] ?? "Something went wrong.";
  return detail && ["missing-parent", "cycle", "in-use"].includes(code) ? `${message}: ${detail}.` : message;
}
