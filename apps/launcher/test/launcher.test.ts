import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Install, NAME, Release, ensureWindowless, identity, windows } from "../src/install.ts";
import { expectedSum, find, pick } from "../src/updates.ts";

const release = (tag: string, prerelease: boolean, names = ["linux-x64", "win-x64"]) => ({
  tag_name: `v${tag}`,
  draft: false,
  prerelease,
  html_url: `https://example.test/${tag}`,
  assets: [...names.map((n) => ({ name: `pispark-${tag}-${n}.tar.gz`, browser_download_url: `https://example.test/${tag}/${n}` })), { name: "SHA256SUMS", browser_download_url: `https://example.test/${tag}/sums` }],
});

test("an update is the newest release for the channel and platform, newer than this one and not failed here", () => {
  const list = [release("0.5.0-main.3", true), release("0.4.3", false), release("0.4.4", false, ["linux-x64"]), release("0.4.2", false)];
  const base = { os: "win" as const, arch: "x64" as const, current: "0.4.2", failed: [] as string[] };
  assert.equal(pick(list, { ...base, channel: "stable" })?.version, "0.4.3");
  assert.equal(pick(list, { ...base, channel: "latest" })?.version, "0.5.0-main.3");
  assert.equal(pick(list, { ...base, channel: "latest", failed: ["0.5.0-main.3"] })?.version, "0.4.3");
  assert.equal(pick(list, { ...base, channel: "stable", current: "0.4.3" }), undefined);
  assert.equal(pick(list, { ...base, os: "linux", channel: "stable" })?.version, "0.4.4");
  const found = pick(list, { ...base, channel: "stable" })!;
  assert.equal(found.archive.name, "pispark-0.4.3-win-x64.tar.gz");
  assert.equal(found.sums, "https://example.test/0.4.3/sums");
  // A draft, or a release without SHA256SUMS, is never offered.
  assert.equal(pick([{ ...release("0.9.0", false), draft: true }], { ...base, channel: "stable" }), undefined);
  assert.equal(pick([{ ...release("0.9.0", false), assets: release("0.9.0", false).assets.slice(0, 2) }], { ...base, channel: "stable" }), undefined);
});

test("SHA256SUMS: the line for exactly this file", () => {
  const sums = `${"a".repeat(64)}  pispark-0.4.3-win-x64.tar.gz\n${"b".repeat(64)} *pispark-0.4.3-linux-x64.tar.gz\n`;
  assert.equal(expectedSum(sums, "pispark-0.4.3-win-x64.tar.gz"), "a".repeat(64));
  assert.equal(expectedSum(sums, "pispark-0.4.3-linux-x64.tar.gz"), "b".repeat(64));
  assert.equal(expectedSum(sums, "pispark-0.4.3-win-x64.tar"), undefined);
});

function fakeRelease(install: Install, version: string) {
  const dir = install.release(version);
  mkdirSync(join(dir, "node"), { recursive: true });
  writeFileSync(join(dir, "release.json"), JSON.stringify({ version, channel: "latest", launcher: 1, os: "win", arch: "x64", node: "22.23.4" }));
  return Release.at(dir);
}

test("install folder: current points at a version, choices persist, old versions are pruned", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pispark-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = new Install(root);
  for (const v of ["0.4.1", "0.4.2", "0.4.3-main.1", "0.4.3"]) fakeRelease(install, v);
  assert.deepEqual(install.installed(), ["0.4.1", "0.4.2", "0.4.3-main.1", "0.4.3"]);
  install.point("0.4.2");
  assert.equal(install.currentVersion(), "0.4.2");
  install.point("0.4.3");
  assert.equal(install.currentVersion(), "0.4.3");
  assert.equal(basename(realpathSync(install.current)), "0.4.3");
  // Removing the link never removes what it pointed to.
  install.point("0.4.1");
  assert.ok(existsSync(join(install.release("0.4.3"), "release.json")));
  assert.throws(() => install.point("9.9.9"), /not installed/);
  assert.equal(Install.of(Release.at(install.release("0.4.2")))?.root, root);

  assert.deepEqual(install.choices(), { channel: "stable", port: 3000, autoUpdate: false });
  install.choose({ channel: "latest", port: 3100, home: "/data" });
  assert.deepEqual(install.choices(), { channel: "latest", port: 3100, autoUpdate: false, home: "/data" });
  writeFileSync(join(root, "state.json"), JSON.stringify({ channel: "beta", port: 99999, autoUpdate: "yes" }));
  assert.deepEqual(install.choices(), { channel: "stable", port: 3000, autoUpdate: false });

  install.prune(["0.4.1"]);
  assert.deepEqual(install.installed(), ["0.4.1", "0.4.3-main.1", "0.4.3"]);
});

test("handover files: failed versions, a version being tried, confirmation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pispark-handover-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = new Install(root);
  assert.deepEqual(install.failed(), []);
  install.markFailed("0.4.3");
  install.markFailed("0.4.3");
  assert.deepEqual(install.failed(), ["0.4.3"]);
  install.startTrying("0.4.4", "0.4.2");
  assert.deepEqual(install.trying(), { version: "0.4.4", previous: "0.4.2" });
  assert.equal(readFileSync(join(root, "update", "previous"), "utf8").trim(), "0.4.2");
  install.confirm();
  assert.equal(install.trying(), undefined);
});

test("Windows: the windowless Node is the same program marked as windowed", { skip: !windows }, (t) => {
  const root = mkdtempSync(join(tmpdir(), "pispark-windowless-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = new Install(root);
  const r = fakeRelease(install, "0.4.2");
  // A minimal PE header: "MZ", the PE offset at 0x3c, "PE\0\0", and the subsystem field (console = 3).
  const exe = Buffer.alloc(512);
  exe.write("MZ", 0, "latin1");
  exe.writeUInt32LE(0x80, 0x3c);
  exe.write("PE\0\0", 0x80, "latin1");
  exe.writeUInt16LE(3, 0x80 + 24 + 68);
  writeFileSync(r.node, exe);
  ensureWindowless(r);
  const made = readFileSync(r.windowless);
  assert.equal(made.readUInt16LE(0x80 + 24 + 68), 2);
  assert.equal(made.length, exe.length);
  writeFileSync(r.node, Buffer.from("not a program"));
  rmSync(r.windowless);
  assert.throws(() => ensureWindowless(r), /not a Windows program/);
});

test("a specific version: found on any channel, only with this platform's archive", () => {
  const list = [release("0.5.0-main.3", true), release("0.4.3", false), release("0.4.4", false, ["linux-x64"])];
  assert.equal(find(list, "0.5.0-main.3", "win", "x64")?.version, "0.5.0-main.3");
  assert.equal(find(list, "0.4.3", "win", "x64")?.archive.name, "pispark-0.4.3-win-x64.tar.gz");
  assert.equal(find(list, "0.4.4", "win", "x64"), undefined);
  assert.equal(find(list, "0.9.9", "win", "x64"), undefined);
});

test("a kept version persists, and asking for a failed version clears its failure", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pispark-kept-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = new Install(root);
  install.choose({ channel: "latest", kept: "0.4.2" });
  assert.equal(install.choices().kept, "0.4.2");
  install.choose({ kept: undefined });
  assert.equal(install.choices().kept, undefined);
  writeFileSync(join(root, "state.json"), JSON.stringify({ kept: "not a version" }));
  assert.equal(install.choices().kept, undefined);
  install.markFailed("0.4.3");
  install.markFailed("0.4.4");
  install.unmarkFailed("0.4.3");
  assert.deepEqual(install.failed(), ["0.4.4"]);
});

test("a named install is called apart from the main one everywhere it registers", () => {
  assert.deepEqual(identity(), { label: "PiSpark", run: "PiSpark", unit: "pispark.service", command: "pispark" });
  assert.deepEqual(identity("dev"), { label: "PiSpark (dev)", run: "PiSpark-dev", unit: "pispark-dev.service", command: "pispark-dev" });
  for (const good of ["dev", "test-2", "a"]) assert.ok(NAME.test(good), good);
  for (const bad of ["", "Dev", "-dev", "dev/x", "a".repeat(21), "dev test"]) assert.ok(!NAME.test(bad), bad);
});
