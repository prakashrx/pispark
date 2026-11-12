import type { RuntimeConfiguration } from "../core/runtime/configuration.js";
import { resolveHome } from "../core/home.js";
import { bundledTransportPatched } from "../core/runtime/transport-gate.js";
import { WORKSPACE_POINTS } from "./workspace-points.js";

/** No config file: the data root is `PISPARK_HOME` or `~/.pispark`. */
export function hostConfiguration(): RuntimeConfiguration {
  if (!bundledTransportPatched(process.versions.undici)) {
    throw new Error(
      `Native providers disabled: Node ${process.versions.node} bundles undici ${process.versions.undici ?? "unknown"}. Use a supported security-patched Node bundling undici >=6.29.1 <7, >=7.30.1 <8, >=8.12.2 (stable). No waiver flag is available.`,
    );
  }
  return { home: resolveHome(), points: WORKSPACE_POINTS };
}
