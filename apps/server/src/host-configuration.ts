import type { RuntimeConfiguration } from "./runtime/configuration.js";
import { resolveHome } from "./home.js";

/** Patched branches for the union of October 2026 undici advisories (see docs/session-protocol.md). */
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

/** No config file: the data root is `PISPARK_HOME` or `~/.pispark`. */
export function hostConfiguration(): RuntimeConfiguration {
  if (!bundledTransportPatched(process.versions.undici)) {
    throw new Error(
      `Native providers disabled: Node ${process.versions.node} bundles undici ${process.versions.undici ?? "unknown"}. Use a supported security-patched Node bundling undici >=6.29.1 <7, >=7.30.1 <8, >=8.12.2 (stable). The npm override does not patch Node. No waiver flag is available.`,
    );
  }
  return { home: resolveHome() };
}
