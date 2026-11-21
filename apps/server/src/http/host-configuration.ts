import { join } from "node:path";
import { loadEnvFile } from "node:process";
import type { RuntimeConfiguration } from "../core/runtime/configuration.js";
import { resolveHome } from "../core/home.js";
import { bundledTransportPatched } from "../core/runtime/transport-gate.js";
import { WORKSPACE_POINTS } from "./workspace-points.js";

/** Resolve the data root first, then load its optional startup environment. */
export function hostConfiguration(): RuntimeConfiguration {
  if (!bundledTransportPatched(process.versions.undici)) {
    throw new Error(
      `Native providers disabled: Node ${process.versions.node} bundles undici ${process.versions.undici ?? "unknown"}. Use a supported security-patched Node bundling undici >=6.29.1 <7, >=7.30.1 <8, >=8.12.2 (stable). No waiver flag is available.`,
    );
  }
  const home = resolveHome();
  const envFile = join(home, ".env");
  try {
    loadEnvFile(envFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Could not load the PiSpark environment file at " + envFile + ".");
  }
  return { home, points: WORKSPACE_POINTS };
}
