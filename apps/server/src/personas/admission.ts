import {
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  chmodSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import type {
  AdmittedPersonaSummary,
  EffectiveResource,
  PersonaSelection,
} from "../persona-protocol.js";
import type { SessionConfiguration } from "../runtime/configuration.js";
import { RuntimeError } from "../runtime/errors.js";
import type { PersonaStore } from "./store.js";
import { publicView, resolvePersona } from "./resolver.js";
import { bytes, contained, noLinks, tree, type FileManifest } from "./files.js";
import {
  canonical,
  PersonaError,
  digest,
  hash,
  object,
  ref,
  relativePath,
} from "./schema.js";

export interface PersonaAdmissionMetadata extends AdmittedPersonaSummary {
  admissionDigest: string;
}
interface AdmittedSkill {
  path: string;
  manifest: FileManifest[];
  legacy: boolean;
}
interface AdmissionRecord {
  version: 1;
  summary: AdmittedPersonaSummary;
  policyFingerprint: string;
  definitions: { ref: AdmittedPersonaSummary["ref"]; revision: string }[];
  instructions: EffectiveResource[];
  agentsFiles: { path: string; content: string }[];
  skills: AdmittedSkill[];
}
export interface AdmittedResources {
  metadata: PersonaAdmissionMetadata;
  instructions: string[];
  agentsFiles: { path: string; content: string }[];
  skillPaths: string[];
  verify: () => void;
}
function policy(configuration: SessionConfiguration): string {
  for (const paths of [
    configuration.instructions,
    configuration.skills,
    configuration.extensions,
  ]) {
    if (
      paths &&
      (paths.length > 32 ||
        paths.some((path) => typeof path !== "string" || !isAbsolute(path)))
    )
      throw new RuntimeError("configuration");
  }
  return hash({
    systemPrompt: configuration.systemPrompt,
    tools: configuration.tools,
    instructions: configuration.instructions ?? [],
    skills: configuration.skills ?? [],
    prompts: configuration.prompts ?? [],
    extensions: (configuration.extensions ?? []).map((path) => ({
      path,
      digest: digest(bytes(path, 1024 * 1024)),
    })),
  });
}
function singleFile(path: string): FileManifest[] {
  const content = bytes(path, 1024 * 1024);
  return [
    {
      path: basename(path),
      bytes: content.length,
      digest: digest(content),
      mode: lstatSync(path).mode & 0o777,
    },
  ];
}
function validateNative(paths: string[], cwd: string): void {
  const loaded = loadSkills({
    cwd,
    agentDir: cwd,
    skillPaths: paths,
    includeDefaults: false,
  });
  if (
    loaded.diagnostics.length ||
    loaded.skills.length !== paths.length ||
    new Set(loaded.skills.map((s) => s.name)).size !== paths.length
  )
    throw new RuntimeError("resources");
}
/** Snapshot supported inputs only. Trusted tools/extensions and external script dependencies are not hermetic. */
export function admitPersona(
  store: PersonaStore,
  selection: PersonaSelection,
  configuration: SessionConfiguration,
  sessionDirectory: string,
): AdmittedResources {
  const stage = join(sessionDirectory, `.persona-${randomUUID()}`),
    target = join(sessionDirectory, "persona");
  try {
    ref(selection, true);
    const resolved = resolvePersona(store, {
      root: selection.root,
      path: selection.path,
      id: selection.id,
    });
    if (resolved.revision !== selection.revision)
      throw new RuntimeError("revision-conflict");
    const policyFingerprint = policy(configuration);
    const checks: (() => void)[] = [resolved.verify];
    const agentsFiles = (configuration.instructions ?? []).map((path) => {
      const content = bytes(path, 64 * 1024),
        before = digest(content);
      checks.push(() => {
        if (digest(bytes(path, 64 * 1024)) !== before)
          throw new RuntimeError("resource-changed");
      });
      return {
        path,
        content: new TextDecoder("utf-8", { fatal: true }).decode(content),
      };
    });
    if (
      agentsFiles.length > 32 ||
      resolved.skills.length + (configuration.skills?.length ?? 0) > 32
    )
      throw new RuntimeError("limit");
    const sources = [
      ...(configuration.skills ?? []).map((path, i) => {
        noLinks(path);
        const legacy = basename(path) !== "SKILL.md",
          directory = dirname(path);
        return {
          source: directory,
          manifest: legacy ? singleFile(path) : tree(directory),
          legacy,
          destination: `skills/host-${i}/${basename(directory)}`,
          entry: basename(path),
        };
      }),
      ...resolved.skills.map((skill) => ({
        source: skill.sourcePath!,
        manifest: skill.manifest!,
        legacy: false,
        destination: `skills/persona-${skill.id}/${basename(skill.sourcePath!)}`,
        entry: "SKILL.md",
      })),
    ];
    let total =
        Buffer.byteLength(JSON.stringify(agentsFiles)) +
        resolved.instructions.reduce(
          (n, r) => n + Buffer.byteLength(r.text!),
          0,
        ),
      files = 0;
    for (const source of sources) {
      total += source.manifest.reduce((n, f) => n + f.bytes, 0);
      files += source.manifest.length;
      checks.push(() => {
        const current = source.legacy
          ? singleFile(join(source.source, source.entry))
          : tree(source.source);
        if (hash(current) !== hash(source.manifest))
          throw new RuntimeError("resource-changed");
      });
    }
    if (total > 36 * 1024 * 1024 || files > 1024)
      throw new RuntimeError("limit");
    noLinks(sessionDirectory);
    mkdirSync(stage, { mode: 0o700 });
    for (const source of sources)
      for (const file of source.manifest) {
        const original = contained(
          source.source,
          join(source.source, file.path),
          "file",
        );
        const content = bytes(original, 1024 * 1024);
        if (digest(content) !== file.digest)
          throw new RuntimeError("resource-changed");
        const destination = join(stage, source.destination, file.path);
        mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
        writeFileSync(destination, content, { flag: "wx", mode: file.mode });
        chmodSync(destination, file.mode);
      }
    for (const check of checks) check();
    if (policy(configuration) !== policyFingerprint)
      throw new RuntimeError("configuration-changed");
    const summary: AdmittedPersonaSummary = {
      ref: resolved.ref,
      name: resolved.definition.name,
      revision: resolved.revision,
      effectiveRevision: resolved.effectiveRevision,
    };
    const record: AdmissionRecord = {
      version: 1,
      summary,
      policyFingerprint,
      definitions: resolved.definitions,
      instructions: publicView(resolved).instructions,
      agentsFiles,
      skills: sources.map((source) => ({
        path: `${source.destination}/${source.entry}`,
        manifest: source.manifest,
        legacy: source.legacy,
      })),
    };
    const serialized = JSON.stringify(record, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > 2 * 1024 * 1024)
      throw new RuntimeError("limit");
    writeFileSync(join(stage, "admission.json"), serialized, {
      flag: "wx",
      mode: 0o600,
    });
    const metadata = { ...summary, admissionDigest: digest(serialized) };
    const staged = readAdmission(stage, metadata, configuration);
    staged.verify();
    validateNative(staged.skillPaths, sessionDirectory);
    for (const check of checks) check();
    noLinks(sessionDirectory);
    renameSync(stage, target);
    const admitted = readAdmission(target, metadata, configuration);
    store.logger.event("resource.admit", {
      personaId: selection.id,
      outcome: "completed",
      counts: {
        instructions: record.instructions.length,
        skills: record.skills.length,
      },
    });
    return admitted;
  } catch (error) {
    store.logger.event("resource.admit", {
      personaId: selection.id,
      outcome: "failed",
      code: error instanceof RuntimeError ? error.code : "resources",
    });
    if (error instanceof RuntimeError) throw error;
    if (error instanceof PersonaError && error.code === "resource-changed")
      throw new RuntimeError("resource-changed");
    throw new RuntimeError("resources");
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}
export function restorePersona(
  sessionDirectory: string,
  metadata: PersonaAdmissionMetadata,
  configuration: SessionConfiguration,
): AdmittedResources {
  try {
    // Unreferenced staging copies are cleaned only under the session's existing ownership.
    for (const name of readdirSync(sessionDirectory))
      if (/^\.persona-[a-f0-9-]{36}$/.test(name))
        rmSync(join(sessionDirectory, name), { recursive: true, force: true });
    return readAdmission(
      join(sessionDirectory, "persona"),
      metadata,
      configuration,
    );
  } catch (error) {
    if (error instanceof RuntimeError) throw error;
    throw new RuntimeError("resource-integrity");
  }
}
function readAdmission(
  directory: string,
  metadata: PersonaAdmissionMetadata,
  configuration: SessionConfiguration,
): AdmittedResources {
  let record: AdmissionRecord;
  try {
    contained(directory, directory, "directory");
    const content = bytes(join(directory, "admission.json"), 2 * 1024 * 1024);
    if (digest(content) !== metadata.admissionDigest) throw new Error();
    const raw: unknown = JSON.parse(content.toString("utf8"));
    const value = object(
      raw,
      [
        "version",
        "summary",
        "policyFingerprint",
        "definitions",
        "instructions",
        "agentsFiles",
        "skills",
      ],
      [
        "version",
        "summary",
        "policyFingerprint",
        "definitions",
        "instructions",
        "agentsFiles",
        "skills",
      ],
    );
    if (value.version !== 1) throw new Error();
    const { admissionDigest: _, ...summary } = metadata;
    if (
      canonical(value.summary) !== canonical(summary) ||
      !Array.isArray(value.instructions) ||
      value.instructions.length > 64 ||
      !Array.isArray(value.agentsFiles) ||
      value.agentsFiles.length > 32 ||
      !Array.isArray(value.skills) ||
      value.skills.length > 32
    )
      throw new Error();
    // SAFETY: exact versioned record is digest-bound to metadata produced at admission; resource paths/manifests are revalidated below.
    record = value as unknown as AdmissionRecord;
    if (
      record.instructions.some(
        (r) =>
          typeof r.text !== "string" || Buffer.byteLength(r.text) > 64 * 1024,
      ) ||
      record.agentsFiles.some(
        (r) =>
          typeof r.path !== "string" ||
          typeof r.content !== "string" ||
          Buffer.byteLength(r.content) > 64 * 1024,
      )
    )
      throw new Error();
  } catch {
    throw new RuntimeError("resource-integrity");
  }
  let currentPolicy: string;
  try {
    currentPolicy = policy(configuration);
  } catch {
    throw new RuntimeError("configuration-changed");
  }
  if (record.policyFingerprint !== currentPolicy)
    throw new RuntimeError("configuration-changed");
  const verify = () => {
    try {
      if (
        digest(bytes(join(directory, "admission.json"), 2 * 1024 * 1024)) !==
        metadata.admissionDigest
      )
        throw new Error();
      for (const skill of record.skills) {
        relativePath(skill.path);
        if (
          !skill.path.startsWith("skills/") ||
          skill.path.split("/").some((p) => p === "." || p === "..")
        )
          throw new Error();
        const path = contained(
          directory,
          resolve(directory, skill.path),
          "file",
        );
        const manifest = skill.legacy ? singleFile(path) : tree(dirname(path));
        if (hash(manifest) !== hash(skill.manifest)) throw new Error();
      }
    } catch {
      throw new RuntimeError("resource-integrity");
    }
  };
  verify();
  return {
    metadata,
    instructions: record.instructions.map((r) => r.text!),
    agentsFiles: record.agentsFiles,
    skillPaths: record.skills.map((s) => join(directory, s.path)),
    verify,
  };
}
export function validAdmissionMetadata(
  value: unknown,
): value is PersonaAdmissionMetadata {
  try {
    const o = object(
      value,
      ["ref", "name", "revision", "effectiveRevision", "admissionDigest"],
      ["ref", "name", "revision", "effectiveRevision", "admissionDigest"],
    );
    ref(o.ref);
    return (
      typeof o.name === "string" &&
      o.name.length > 0 &&
      o.name.length <= 120 &&
      [o.revision, o.effectiveRevision, o.admissionDigest].every(
        (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
      )
    );
  } catch {
    return false;
  }
}
