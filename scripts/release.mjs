// Builds one PiSpark release archive for an OS and CPU, from an already built checkout (`npm run build`):
//
//   node scripts/release.mjs [--os win|linux] [--arch x64|arm64] [--version 0.1.0] [--channel stable|latest] [--out release]
//
// The archive, pispark-<version>-<os>-<arch>.tar.gz, holds one folder with:
//   node/          the pinned Node runtime (on Windows the launcher makes pispark.exe from it when installed)
//   app/           the built server, web and launcher, with the server's production dependencies
//   release.json   what this release is
// and SHA256SUMS in the output folder lists every archive there.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The Node every release runs on. Must pass the server's undici security gate (transport-gate.ts). */
const NODE_VERSION = "22.23.4";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const os = option("os", process.platform === "win32" ? "win" : "linux");
const arch = option("arch", process.arch === "arm64" ? "arm64" : "x64");
const version = option("version", JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version);
const channel = option("channel", /-/.test(version) ? "latest" : "stable");
const out = resolve(repo, option("out", "release"));
if (!["win", "linux"].includes(os) || !["x64", "arm64"].includes(arch)) throw new Error("--os win|linux, --arch x64|arm64");
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error(`Not a version: ${version}`);
for (const built of ["apps/server/dist/index.js", "apps/web/dist/index.html", "apps/launcher/dist/pispark.mjs"])
  if (!existsSync(join(repo, built))) throw new Error(`${built} is missing: run npm run build first`);

const windowsHost = process.platform === "win32";
// Windows cannot record Linux file modes (the executable bit on node and esbuild): build Linux releases on Linux.
if (windowsHost && os === "linux") throw new Error("Build Linux releases on Linux (or in WSL); a Windows-made archive loses the executable bits.");
const tar = windowsHost ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const run = (file, argv, options = {}) => {
  const result = spawnSync(file, argv, { stdio: "inherit", shell: false, ...options });
  if (result.status !== 0) throw new Error(`${file} ${argv.join(" ")} failed`);
};
const name = `pispark-${version}-${os}-${arch}`;
const stage = join(out, ".stage", name);
rmSync(join(out, ".stage"), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 1. Node, from nodejs.org, checked against its SHASUMS256.txt, cached between builds.
const nodeFile = `node-v${NODE_VERSION}-${os === "win" ? "win" : "linux"}-${arch}.${os === "win" ? "zip" : "tar.xz"}`;
const cache = join(repo, ".cache", "node");
mkdirSync(cache, { recursive: true });
const cached = join(cache, nodeFile);
if (!existsSync(cached)) {
  const sums = await (await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((l) => l.endsWith(`  ${nodeFile}`))?.split(" ")[0];
  if (!expected) throw new Error(`nodejs.org lists no ${nodeFile}`);
  console.log(`Downloading ${nodeFile}`);
  const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${nodeFile}`);
  if (!response.ok) throw new Error(`${nodeFile}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error(`${nodeFile} does not match SHASUMS256.txt`);
  writeFileSync(cached, bytes);
}
const unpacked = join(out, ".stage", "node");
mkdirSync(unpacked, { recursive: true });
run(tar, ["-xf", cached, "-C", unpacked]);
renameSync(join(unpacked, readdirSync(unpacked)[0]), join(stage, "node"));
// npm and corepack are not needed to run PiSpark.
for (const extra of ["node_modules", "npm", "npm.cmd", "npm.ps1", "npx", "npx.cmd", "npx.ps1", "corepack", "corepack.cmd", "install_tools.bat", "nodevars.bat", "include", "share", "CHANGELOG.md", "README.md"])
  rmSync(join(stage, "node", extra), { recursive: true, force: true });
for (const extra of ["npm", "npx", "corepack"]) rmSync(join(stage, "node", "bin", extra), { force: true });
rmSync(join(stage, "node", "lib", "node_modules"), { recursive: true, force: true });

// 2. The app: production dependencies of the server for the target platform, from the lockfile.
const app = join(stage, "app");
mkdirSync(app, { recursive: true });
for (const file of ["package.json", "package-lock.json", "LICENSE"]) if (existsSync(join(repo, file))) cpSync(join(repo, file), join(app, file));
for (const workspace of ["server", "web", "launcher"]) {
  mkdirSync(join(app, "apps", workspace), { recursive: true });
  cpSync(join(repo, "apps", workspace, "package.json"), join(app, "apps", workspace, "package.json"));
}
const npm = windowsHost ? "npm.cmd" : "npm";
run(npm, ["ci", "--omit=dev", "--workspace=@pispark/server", `--os=${os === "win" ? "win32" : "linux"}`, `--cpu=${arch}`, "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
  cwd: app,
  shell: windowsHost,
});
rmSync(join(app, "node_modules", "@pispark"), { recursive: true, force: true });
rmSync(join(app, "node_modules", ".package-lock.json"), { force: true });
for (const [from, to] of [
  ["apps/server/dist", "apps/server/dist"],
  ["apps/web/dist", "apps/web/dist"],
  ["apps/launcher/dist", "apps/launcher/dist"],
])
  cpSync(join(repo, from), join(app, to), { recursive: true, filter: (f) => !f.endsWith(".map") });

// 3. What this release is.
const launcherSource = readFileSync(join(repo, "apps/launcher/src/install.ts"), "utf8");
const launcher = Number(/LAUNCHER_VERSION = (\d+)/.exec(launcherSource)?.[1]);
let commit;
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
} catch {
  /* Not a git checkout. */
}
writeFileSync(
  join(stage, "release.json"),
  JSON.stringify({ version, channel, launcher, os, arch, node: NODE_VERSION, ...(commit ? { commit } : {}), builtAt: new Date().toISOString() }, null, 2) + "\n",
);

// 4. The archive and SHA256SUMS.
const archive = join(out, `${name}.tar.gz`);
rmSync(archive, { force: true });
run(tar, ["-czf", archive, "-C", join(out, ".stage"), name]);
rmSync(join(out, ".stage"), { recursive: true, force: true });
const lines = [];
for (const file of readdirSync(out).filter((f) => f.endsWith(".tar.gz")).sort()) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(out, file))) hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${file}`);
}
writeFileSync(join(out, "SHA256SUMS"), lines.join("\n") + "\n");
console.log(`Built ${archive}`);
