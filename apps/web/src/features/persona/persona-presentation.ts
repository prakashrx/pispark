import type {
  EffectiveResource,
  PersonaRef,
  PersonaSummary,
} from "../../../../server/src/persona-protocol";

export function samePersona(a: PersonaRef, b: PersonaRef): boolean {
  return a.root === b.root && a.path === b.path && a.id === b.id;
}
export function resourceLabel(resource: EffectiveResource): string {
  const text =
    resource.nativeName ||
    resource.text?.split(/\r?\n/u).find((line) => line.trim()) ||
    (resource.file || resource.directory)
      ?.split(/[/]/)
      .filter(Boolean)
      .at(-1) ||
    `Reference ${resource.id}`;
  return Array.from(text.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim())
    .slice(0, 80)
    .join("");
}
export function personaName(
  ref: PersonaRef,
  options: PersonaSummary[],
): string {
  return (
    options.find((p) => samePersona(p.ref, ref))?.name ?? "Unavailable persona"
  );
}
export type PersonaErrorContext = "document" | "draft" | "file";
export function personaError(
  error: string,
  context: PersonaErrorContext = "document",
  retainedEdits = false,
): string {
  if (error.startsWith("The file was saved,")) return error;
  // Match the leading safe code, not a reference name or path in diagnostic details.
  const code = error.match(/^[a-z]+(?:-[a-z]+)*/u)?.[0] ?? "";
  if (/^(revision-conflict|resource-changed)$/.test(code))
    return `This persona changed elsewhere. ${retainedEdits ? "Your edits are safe. " : ""}Reload the saved version to review the changes.`;
  if (code === "invalid-definition" && context !== "file")
    return context === "draft"
      ? "Check this persona’s name, instructions, and skills."
      : "This persona’s file isn’t valid. Fix the original file to continue.";
  if (/^(missing-resource|missing-parent)$/.test(code))
    return "An instruction file or skill folder couldn’t be found.";
  if (code === "file-draft-limit")
    return "Too many files have unsaved changes. Save one, then reopen this file.";
  if (code === "duplicate-identity")
    return "These persona files share the same identity. Fix the duplicate files to continue.";
  if (code === "cycle")
    return "These personas depend on each other. Remove one connection to continue.";
  if (
    /^(resource-conflict|duplicate-resource|skill-name-conflict|invalid-replacement)$/.test(
      code,
    )
  )
    return "Some instructions or skills have the same reference name. Choose which one to use.";
  if (code === "unsupported-version")
    return "This persona uses a format this version can’t edit.";
  if (code === "read-only") return "This persona is read-only.";
  if (/^(path-outside-root|symlink|ownership|identity-mismatch)$/.test(code))
    return "This file isn’t available to this persona.";
  if (code === "storage")
    return `Couldn’t save the changes.${retainedEdits ? " Your edits are still here." : ""}`;
  if (/^(limit|too-large)$/.test(code))
    return "This persona is too large or has too many linked resources.";
  if (/^(busy|shutdown|closed)$/.test(code))
    return "The workspace is busy. Try again shortly.";
  return `Couldn’t complete that action.${retainedEdits ? " Your edits are still here." : ""}`;
}

// Present authoritative order, substituting current local draft entries without resolving inheritance.
// While stale, retained inherited rows are explicitly labelled as the last checked result by the page.
export function resourceRows<
  T extends { id: string; file?: string; directory?: string },
>(
  local: T[],
  effective: EffectiveResource[],
  owner: PersonaRef,
): { local?: T; resolved?: EffectiveResource }[] {
  const shown = new Set<T>();
  const rows = effective.flatMap<{ local?: T; resolved?: EffectiveResource }>(
    (resolved) => {
      if (!samePersona(resolved.origin, owner)) return [{ resolved }];
      const item = local.find((entry) => entry.id === resolved.id);
      if (!item) return [];
      shown.add(item);
      return [
        {
          local: item,
          resolved:
            item.file === resolved.file && item.directory === resolved.directory
              ? resolved
              : undefined,
        },
      ];
    },
  );
  return [
    ...rows,
    ...local
      .filter((item) => !shown.has(item))
      .map((item) => ({ local: item })),
  ];
}
