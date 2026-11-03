import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import type {
  EffectiveResource,
  PersonaDefinition,
  PersonaRef,
  PersonaView,
} from "../persona-protocol.js";
import type { PersonaStore, StoredPersona } from "./store.js";
import { definition, digest, fail, hash, PersonaError } from "./schema.js";
import {
  bytes,
  resourcePath,
  storageError,
  tree,
  type FileManifest,
} from "./files.js";

export interface ResolvedResource extends EffectiveResource {
  declarationRevision: string;
  signature: string;
  contentDigest: string;
  sourcePath?: string;
  manifest?: FileManifest[];
}
export interface ResolvedPersona
  extends Omit<PersonaView, "instructions" | "skills"> {
  instructions: ResolvedResource[];
  skills: ResolvedResource[];
  definitions: { ref: PersonaRef; revision: string }[];
  revisionInputs: {
    definitions: { ref: PersonaRef; revision: string }[];
    resources: { ref: PersonaRef; type: string; id: string; digest: string }[];
  };
  verify: () => void;
}
// Resolution data is detached and frozen once complete; callers cannot mutate an admitted generation.
function freezeResolution(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeResolution(child);
}
const types = ["instructions", "skills"] as const;
const key = (ref: PersonaRef) => `${ref.root}/${ref.path}/${ref.id}`;
function safeResource(resource: ResolvedResource): EffectiveResource {
  const {
    id,
    origin,
    routes,
    replaced,
    text,
    file,
    directory,
    nativeName,
    description,
    disableModelInvocation,
  } = resource;
  return {
    id,
    origin,
    routes,
    replaced,
    text,
    file,
    directory,
    nativeName,
    description,
    disableModelInvocation,
  };
}
export function publicView(result: ResolvedPersona): PersonaView {
  const {
    ref,
    definition,
    writable,
    definitionRevision,
    revision,
    effectiveRevision,
    excluded,
    diagnostics,
  } = result;
  return {
    ref,
    definition,
    writable,
    definitionRevision,
    revision,
    effectiveRevision,
    excluded,
    diagnostics,
    instructions: result.instructions.map(safeResource),
    skills: result.skills.map(safeResource),
  };
}
export function resolvePersona(
  store: PersonaStore,
  reference: PersonaRef,
  draft?: PersonaDefinition,
  checkIdentities = true,
  stagedDirectory?: string,
  operationTemporary?: string,
): ResolvedPersona {
  const started = Date.now();
  try {
    if (checkIdentities) store.assertIdentities();
    const stack = new Set<string>(),
      memo = new Map<string, { result: ResolvedPersona; height: number }>();
    const definitions: ResolvedPersona["definitions"] = [],
      checks: (() => void)[] = [];
    let edges = 0,
      instructionBytes = 0,
      skillFiles = 0,
      skillBytes = 0;
    const trees = new Map<string, FileManifest[]>();
    const resources: {
      ref: PersonaRef;
      type: string;
      id: string;
      digest: string;
    }[] = [];
    const visit = (ref: PersonaRef, depth: number): ResolvedPersona => {
      const identity = key(ref);
      if (stack.has(identity)) fail("cycle");
      const cached = memo.get(identity);
      if (cached) {
        if (depth + cached.height - 1 > 16) fail("limit");
        return cached.result;
      }
      if (depth > 16 || definitions.length >= 64) fail("limit");
      stack.add(identity);
      const selected = identity === key(reference);
      const stored: StoredPersona =
        selected && stagedDirectory
          ? {
              ...store.location(ref),
              directory: stagedDirectory,
              ref,
              definition: definition(draft),
              definitionRevision: digest(JSON.stringify(draft, null, 2) + "\n"),
            }
          : store.read(ref);
      if (!stagedDirectory || !selected) {
        checks.push(() => {
          if (store.read(ref).definitionRevision !== stored.definitionRevision)
            fail("resource-changed");
        });
      }
      const value = selected && draft ? definition(draft) : stored.definition;
      if (value.id !== ref.id) fail("identity-mismatch");
      const declarationRevision =
        selected && draft ? hash(value) : stored.definitionRevision;
      definitions.push({ ref: { ...ref }, revision: declarationRevision });
      const slots: Record<
        (typeof types)[number],
        Map<string, ResolvedResource[]>
      > = { instructions: new Map(), skills: new Map() };
      const excluded: PersonaView["excluded"] = [];
      let height = 1;
      for (const parent of value.parents ?? []) {
        if (++edges > 128) fail("limit");
        const parentRef = {
          root: parent.root,
          path: parent.path,
          id: parent.id,
        };
        const result = visit(parentRef, depth + 1);
        height = Math.max(height, 1 + memo.get(key(parentRef))!.height);
        for (const type of types) {
          const selection = parent.include?.[type];
          if (selection?.some((id) => !result[type].some((r) => r.id === id)))
            fail("unknown-selection");
          for (const resource of result[type]) {
            if (selection && !selection.includes(resource.id)) continue;
            const incoming = structuredClone(resource);
            incoming.routes = [
              ...new Map(
                [...incoming.routes, parentRef].map((r) => [key(r), r]),
              ).values(),
            ];
            const candidates = slots[type].get(resource.id) ?? [];
            const same = candidates.find(
              (r) => r.signature === incoming.signature,
            );
            if (same)
              same.routes = [
                ...new Map(
                  [...same.routes, ...incoming.routes].map((r) => [key(r), r]),
                ).values(),
              ];
            else candidates.push(incoming);
            slots[type].set(resource.id, candidates);
          }
        }
      }
      for (const type of types) {
        for (const id of value.exclude?.[type] ?? []) {
          if ((value[type] ?? []).some((r) => r.id === id))
            fail("invalid-replacement");
          const candidates = slots[type].get(id);
          if (!candidates) fail("unknown-selection");
          excluded.push({ type, id, origins: candidates.map((r) => r.origin) });
          slots[type].delete(id);
        }
        for (const entry of value[type] ?? []) {
          const inherited = slots[type].get(entry.id);
          if (entry.replace ? !inherited : inherited)
            fail("invalid-replacement");
          const resource: ResolvedResource = {
            id: entry.id,
            origin: { ...ref },
            routes: [],
            replaced: [
              ...new Map(
                (
                  inherited?.flatMap((r) => [r.origin, ...r.replaced]) ?? []
                ).map((r) => [key(r), r]),
              ).values(),
            ],
            declarationRevision,
            signature: "",
            contentDigest: "",
          };
          if (type === "instructions") {
            const instruction = entry as NonNullable<
              PersonaDefinition["instructions"]
            >[number];
            if (instruction.file === undefined)
              resource.text = instruction.text;
            else {
              const path = resourcePath(
                stored.root,
                stored.directory,
                instruction.file,
                "file",
              );
              const content = bytes(path, 64 * 1024);
              resource.file = instruction.file;
              resource.sourcePath = path;
              try {
                resource.text = new TextDecoder("utf-8", {
                  fatal: true,
                }).decode(content);
              } catch {
                fail("invalid-resource");
              }
              const before = digest(content);
              resource.contentDigest = before;
              checks.push(() => {
                if (
                  digest(
                    bytes(
                      resourcePath(
                        stored.root,
                        stored.directory,
                        instruction.file!,
                        "file",
                      ),
                      64 * 1024,
                    ),
                  ) !== before
                )
                  fail("resource-changed");
              });
            }
            if (!resource.text?.trim() || resource.text.includes("\0"))
              fail("invalid-resource");
            instructionBytes += Buffer.byteLength(resource.text);
            if (instructionBytes > 2 * 1024 * 1024) fail("limit");
            resource.contentDigest ||= digest(resource.text);
          } else {
            const skill = entry as NonNullable<
              PersonaDefinition["skills"]
            >[number];
            const path = resourcePath(
              stored.root,
              stored.directory,
              skill.directory,
              "directory",
            );
            let manifest = trees.get(path);
            if (!manifest) {
              manifest = tree(path, operationTemporary);
              trees.set(path, manifest);
              skillFiles += manifest.length;
              skillBytes += manifest.reduce((n, f) => n + f.bytes, 0);
              if (skillFiles > 1024 || skillBytes > 32 * 1024 * 1024)
                fail("limit");
              const before = hash(manifest);
              checks.push(() => {
                resourcePath(
                  stored.root,
                  stored.directory,
                  skill.directory,
                  "directory",
                );
                if (hash(tree(path, operationTemporary)) !== before)
                  fail("resource-changed");
              });
            }
            const native = loadSkills({
              cwd: stored.directory,
              agentDir: stored.directory,
              skillPaths: [join(path, "SKILL.md")],
              includeDefaults: false,
            });
            if (native.diagnostics.length || native.skills.length !== 1)
              fail("invalid-skill");
            const loaded = native.skills[0]!;
            Object.assign(resource, {
              directory: skill.directory,
              sourcePath: path,
              manifest,
              contentDigest: hash(manifest),
              nativeName: loaded.name,
              description: loaded.description,
              disableModelInvocation: loaded.disableModelInvocation,
            });
          }
          resource.signature = hash({
            origin: ref,
            id: entry.id,
            declarationRevision,
            path: resource.file ?? resource.directory,
            digest: resource.contentDigest,
          });
          resources.push({
            ref: { ...ref },
            type,
            id: entry.id,
            digest: resource.contentDigest,
          });
          slots[type].set(entry.id, [resource]);
        }
        for (const [id, candidates] of slots[type])
          if (candidates.length > 1)
            throw new PersonaError("resource-conflict", 409, [
              {
                code: "resource-conflict",
                resourceType: type,
                resourceId: id,
                refs: candidates.map((r) => r.origin),
              },
            ]);
      }
      const instructions = [...slots.instructions.values()].map((r) => r[0]!);
      const skills = [...slots.skills.values()].map((r) => r[0]!);
      if (
        instructions.length > 64 ||
        instructions.reduce((n, r) => n + Buffer.byteLength(r.text!), 0) >
          256 * 1024 ||
        skills.length > 32
      )
        fail("limit");
      if (new Set(skills.map((s) => s.sourcePath)).size !== skills.length)
        fail("duplicate-resource");
      if (new Set(skills.map((s) => s.nativeName)).size !== skills.length)
        fail("skill-name-conflict");
      const result: ResolvedPersona = {
        ref: { ...ref },
        definition: value,
        writable: stored.writable,
        definitionRevision: stored.definitionRevision,
        revision: "",
        effectiveRevision: hash({
          instructions: instructions.map((r) => ({
            ...safeResource(r),
            contentDigest: r.contentDigest,
          })),
          skills: skills.map((r) => ({
            ...safeResource(r),
            contentDigest: r.contentDigest,
          })),
          excluded,
        }),
        instructions,
        skills,
        excluded,
        diagnostics: [],
        definitions,
        revisionInputs: { definitions, resources },
        verify: () => {},
      };
      stack.delete(identity);
      memo.set(identity, { result, height });
      return result;
    };
    const result = visit(reference, 1);
    result.revision = hash({ definitions, resources });
    result.verify = () => {
      try {
        for (const check of checks) check();
      } catch {
        fail("resource-changed");
      }
    };
    result.verify();
    store.logger.event("persona.resolve", {
      personaId: reference.id,
      outcome: "completed",
      durationMs: Date.now() - started,
      counts: {
        definitions: definitions.length,
        instructions: result.instructions.length,
        skills: result.skills.length,
      },
    });
    freezeResolution(result);
    return result;
  } catch (error) {
    store.logger.event("persona.resolve", {
      personaId: reference.id,
      outcome: "failed",
      code: error instanceof PersonaError ? error.code : "storage",
      durationMs: Date.now() - started,
    });
    storageError(error);
  }
}
