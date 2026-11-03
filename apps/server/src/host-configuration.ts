import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import type { RuntimeConfiguration } from "./runtime/session-runtime.js";
import type { Catalog } from "./protocol.js";

/** Patched branches for the union of October2026 undici advisories (see docs/session-protocol.md). */
export function bundledTransportPatched(version: string | undefined): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  if (major > 8) return true;
  const floor =
    major === 6
      ? [29, 1]
      : major === 7
        ? [30, 1]
        : major === 8
          ? [12, 2]
          : undefined;
  return (
    !!floor && (minor > floor[0]! || (minor === floor[0] && patch >= floor[1]!))
  );
}
export async function hostConfiguration(): Promise<RuntimeConfiguration> {
  if (!bundledTransportPatched(process.versions.undici)) {
    throw new Error(
      `Native providers disabled: Node ${process.versions.node} bundles undici ${process.versions.undici ?? "unknown"}. Use a supported security-patched Node bundling undici >=6.29.1 <7, >=7.30.1 <8, >=8.12.2 (stable). The npm override does not patch Node. No waiver flag is available.`,
    );
  }
  const modulePath = process.env.PISPARK_CONFIG;
  if (!modulePath)
    return {
      storageDir: resolve(homedir(), ".pispark", "sessions"),
      workspaces: {},
      configurations: {},
      resolveSecret: async () => undefined,
    };
  if (!isAbsolute(modulePath))
    throw new Error(
      "PISPARK_CONFIG must be an absolute path to an operator-owned trusted module.",
    );
  let configuration: RuntimeConfiguration;
  try {
    configuration = (await import(pathToFileURL(modulePath).href)).default;
  } catch {
    throw new Error(
      "Unable to load trusted PiSpark configuration module. Check its path and imports locally.",
    );
  }
  if (
    !configuration ||
    !isAbsolute(configuration.storageDir) ||
    !configuration.workspaces ||
    !configuration.configurations ||
    typeof configuration.resolveSecret !== "function"
  )
    throw new Error("Invalid PiSpark server configuration.");
  if (
    configuration.providerSettings &&
    (!isAbsolute(configuration.providerSettings.directory) ||
      (configuration.providerSettings.modelsPath != null &&
        !isAbsolute(configuration.providerSettings.modelsPath)))
  )
    throw new Error(
      "PiSpark provider paths must be explicit absolute host paths.",
    );
  if (
    configuration.logging?.directory &&
    !isAbsolute(configuration.logging.directory)
  )
    throw new Error("PiSpark log directory must be an absolute host path.");
  if (
    configuration.personas &&
    (!isAbsolute(configuration.personas.directory) ||
      Object.keys(configuration.personas.roots ?? {}).length > 15 ||
      Object.entries(configuration.personas.roots ?? {}).some(
        ([key, path]) =>
          key === "managed" ||
          !/^[a-z][a-z0-9-]{0,63}$/.test(key) ||
          !isAbsolute(path),
      ))
  )
    throw new Error("Invalid PiSpark persona roots.");
  return configuration;
}
export function catalog(configuration: RuntimeConfiguration): Catalog {
  const options = (values: string[]) => {
    if (values.length > 64 || values.some((key) => !key || key.length > 128))
      throw new Error(
        "At most64 configuration/workspace keys of1–128 characters are supported.",
      );
    return values.map((value) => ({ value, label: value }));
  };
  return {
    workspaces: options(Object.keys(configuration.workspaces)),
    configurations: options(Object.keys(configuration.configurations)).map(
      (option) => ({
        ...option,
        skillReader: configuration.configurations[option.value]!.tools.some(
          (tool) => tool === "read" || tool === "bash",
        ),
        modelSelection:
          "stored" in configuration.configurations[option.value]!.credential
            ? "catalog"
            : "fixed",
      }),
    ),
  };
}
