import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, type ReleaseChannel } from "../../server/src/contract/host-protocol.ts";
import { Release, ensureWindowless, windows, type Install, type ReleaseInfo } from "./install.ts";

/** Where releases are listed: this repository's GitHub Releases, unless setup recorded another list. */
export const RELEASES_URL = "https://api.github.com/repos/prakashrx/pispark/releases?per_page=30";

export interface Available {
  version: string;
  archive: { name: string; url: string };
  sums: string;
  notes?: string;
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url?: string;
  assets: { name: string; browser_download_url: string }[];
}

export function archiveName(version: string, os: ReleaseInfo["os"], arch: ReleaseInfo["arch"]) {
  return `pispark-${version}-${os}-${arch}.tar.gz`;
}

/**
 * The newest release for this platform on a channel that is newer than `current` and has not
 * failed here. Stable sees releases; Latest sees prereleases (builds of main) too.
 */
export function pick(
  releases: GitHubRelease[],
  { channel, os, arch, current, failed }: { channel: ReleaseChannel; os: ReleaseInfo["os"]; arch: ReleaseInfo["arch"]; current: string; failed: string[] },
): Available | undefined {
  let best: Available | undefined;
  for (const r of releases) {
    if (r.draft || (r.prerelease && channel === "stable")) continue;
    const version = r.tag_name.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) continue;
    if (compareVersions(version, current) <= 0 || failed.includes(version)) continue;
    const name = archiveName(version, os, arch);
    const archive = r.assets.find((a) => a.name === name);
    const sums = r.assets.find((a) => a.name === "SHA256SUMS");
    if (!archive || !sums) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = { version, archive: { name, url: archive.browser_download_url }, sums: sums.browser_download_url, ...(r.html_url ? { notes: r.html_url } : {}) };
  }
  return best;
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": "pispark-launcher" };

export async function check(url: string, options: Parameters<typeof pick>[1]): Promise<Available | undefined> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Release list: HTTP ${response.status}`);
  return pick((await response.json()) as GitHubRelease[], options);
}

/**
 * Downloads a release, checks it against the release's SHA256SUMS and unpacks it into
 * `versions/<version>/`. Nothing running is touched; a failure leaves no partial version behind.
 */
export async function fetchRelease(install: Install, available: Available, progress: (received: number, total?: number) => void): Promise<void> {
  const target = install.release(available.version);
  if (existsSync(join(target, "release.json"))) return;
  mkdirSync(install.downloads, { recursive: true });
  const sumsResponse = await fetch(available.sums, { headers, signal: AbortSignal.timeout(20_000) });
  if (!sumsResponse.ok) throw new Error(`SHA256SUMS: HTTP ${sumsResponse.status}`);
  const expected = expectedSum(await sumsResponse.text(), available.archive.name);
  if (!expected) throw new Error(`SHA256SUMS lists no ${available.archive.name}`);

  const file = join(install.downloads, available.archive.name);
  const partial = `${file}.part`;
  const response = await fetch(available.archive.url, { headers: { "User-Agent": headers["User-Agent"] }, signal: AbortSignal.timeout(15 * 60_000) });
  if (!response.ok || !response.body) throw new Error(`Download: HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || undefined;
  const hash = createHash("sha256");
  const out = createWriteStream(partial);
  let received = 0;
  let lastReport = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise<void>((done) => out.once("drain", () => done()));
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now();
        progress(received, total);
      }
    }
    await new Promise<void>((done, fail) => out.end((error?: Error | null) => (error ? fail(error) : done())));
  } catch (error) {
    out.destroy();
    rmSync(partial, { force: true });
    throw error;
  }
  progress(received, total);
  if (hash.digest("hex") !== expected) {
    rmSync(partial, { force: true });
    throw new Error("The download does not match SHA256SUMS");
  }
  renameSync(partial, file);
  try {
    unpack(file, install, available.version);
  } finally {
    rmSync(file, { force: true });
  }
}

export function expectedSum(sums: string, name: string): string | undefined {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2] === name) return m[1]!.toLowerCase();
  }
}

/** Unpacks an archive (one top folder) into `versions/<version>/`. */
export function unpack(file: string, install: Install, version: string) {
  const staging = join(install.versions, `.unpack-${version}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const result = spawnSync(tar(), ["-xzf", file, "-C", staging], { windowsHide: true, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Unpacking failed: ${(result.stderr || result.error?.message || "").trim()}`);
    const [top] = readdirSync(staging);
    if (!top || !existsSync(join(staging, top, "release.json"))) throw new Error("The archive holds no release");
    ensureWindowless(Release.at(join(staging, top)));
    renameSync(join(staging, top), install.release(version));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Windows' own tar (bsdtar, in every Windows since 2018); Git's tar reads `C:` as a remote host. */
export function tar() {
  return windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}
