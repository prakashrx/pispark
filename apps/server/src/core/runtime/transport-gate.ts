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
