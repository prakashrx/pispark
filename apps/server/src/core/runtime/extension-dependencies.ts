import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const registry = "https://registry.npmjs.org";
type Package = Record<string, unknown>;

export class DependencyPreparationError extends Error {}

/** Resolve npm beside Node, including the layout of each distributed PiSpark build. */
function npmCli(): string {
  const node = dirname(process.execPath);
  const cli = [
    join(node, "node_modules", "npm", "bin", "npm-cli.js"),
    join(node, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find(existsSync);
  if (!cli) throw new DependencyPreparationError("The running Node installation has no npm CLI.");
  return cli;
}

async function packageJson(path: string): Promise<Package> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Package;
  } catch {
    /* A missing or malformed package is reported with its file name. */
  }
  throw new DependencyPreparationError(`Give the extension a valid ${path.endsWith("package-lock.json") ? "package-lock.json" : "package.json"}.`);
}

/** Session drafts use frozen registry packages. npm is allowed to unpack them, not to run install scripts. */
async function validateLock(source: string): Promise<void> {
  const lock = await packageJson(join(source, "package-lock.json"));
  const packages = lock.packages;
  if ((lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !packages || typeof packages !== "object")
    throw new DependencyPreparationError("Generate a current npm package-lock.json for the extension.");
  for (const [path, raw] of Object.entries(packages)) {
    if (path === "") continue;
    const entry = raw as Package | undefined;
    if (!entry || typeof entry !== "object" || !path.startsWith("node_modules/") || entry.link)
      throw new DependencyPreparationError("Extension dependencies must be locked npm registry packages.");
    if (typeof entry.resolved === "string" && entry.resolved.startsWith(registry + "/") && typeof entry.integrity === "string" && /^sha(?:256|384|512)-/.test(entry.integrity))
      continue;
    // Bundled dependencies travel inside a checked registry tarball.
    if (entry.inBundle === true) continue;
    throw new DependencyPreparationError("Extension dependencies must have registry URLs and integrity hashes in the lockfile.");
  }
}

/** Retain the source-only snapshot and publish a prepared revision only after npm succeeds. */
export async function prepareDependencies(source: string, destination: string): Promise<void> {
  if (existsSync(destination) || !existsSync(join(source, "package.json"))) return;
  const manifest = await packageJson(join(source, "package.json"));
  if (!["dependencies", "optionalDependencies", "peerDependencies"].some((key) => Object.keys(manifest[key] ?? {}).length)) return;
  await validateLock(source);
  const cli = npmCli();
  const temp = `${destination}-${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await cp(source, temp, { recursive: true, errorOnExist: true, force: false });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|node_options$|node_auth_token$|npm_token$)/i.test(key)));
    try {
      await run(process.execPath, [
        cli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
        "--registry", registry, "--userconfig", join(temp, ".npmrc"),
        "--globalconfig", join(temp, ".npm-globalrc"),
        "--fetch-retries=0", "--loglevel=error",
      ], { cwd: temp, env, windowsHide: true, timeout: 90_000, maxBuffer: 128 * 1024 });
    } catch (error) {
      const failure = error as { killed?: boolean; stderr?: string };
      if (failure.killed) throw new DependencyPreparationError("Preparing extension dependencies exceeded its time or output limit.");
      const code = /(?:npm (?:ERR!|error) code )([A-Z0-9_]+)/.exec(failure.stderr ?? "")?.[1];
      throw new DependencyPreparationError(`Could not install locked extension dependencies${code ? ` (${code})` : ""}. Check package.json and package-lock.json.`);
    }
    await rename(temp, destination);
  } finally { await rm(temp, { recursive: true, force: true }).catch(() => {}); }
}
