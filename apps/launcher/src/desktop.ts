import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { identity, windows, type Install } from "./install.ts";

/**
 * What PiSpark registers on the machine: starting at login, the Start menu entry, the `pispark`
 * command; and opening its window. Windows: a per-user Run entry (no admin). Linux: a systemd user
 * service that runs `pispark-start`, which also rolls back a launcher that failed to start.
 */
const system32 = (file: string) => join(process.env.SystemRoot ?? "C:\\Windows", "System32", file);
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const names = (install: Install) => identity(install.choices().name);
const startMenu = (install: Install) =>
  join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", `${names(install).label}.lnk`);
const systemdUnit = (install: Install) => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", names(install).unit);
const binDir = () => join(homedir(), ".local", "bin");

/** The command that runs the current version's launcher (`current` never changes, so neither does this). */
function launcherCommand(install: Install, command: string) {
  const exe = join(install.current, "node", windows ? "pispark.exe" : "bin/node");
  const script = join(install.current, "app", "apps", "launcher", "dist", "pispark.mjs");
  return { exe, args: [script, command] };
}

export function enableAutostart(install: Install) {
  if (windows) {
    const { exe, args } = launcherCommand(install, "run");
    const value = [exe, ...args].map((a) => `"${a}"`).join(" ");
    run(system32("reg.exe"), ["add", RUN_KEY, "/v", names(install).run, "/t", "REG_SZ", "/d", value, "/f"]);
    return;
  }
  writeStartScript(install);
  const unit = systemdUnit(install);
  mkdirSync(join(unit, ".."), { recursive: true });
  writeFileSync(
    unit,
    [
      "[Unit]",
      `Description=${names(install).label}`,
      "After=network-online.target",
      "",
      "[Service]",
      `ExecStart=${join(install.root, "pispark-start")}`,
      "Restart=on-failure",
      "RestartSec=2",
      "",
      "[Install]",
      "WantedBy=default.target",
      "",
    ].join("\n"),
  );
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", names(install).unit]);
}

export function disableAutostart(install: Install) {
  if (windows) {
    spawnSync(system32("reg.exe"), ["delete", RUN_KEY, "/v", names(install).run, "/f"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  spawnSync("systemctl", ["--user", "disable", "--now", names(install).unit], { stdio: "ignore" });
  rmSync(systemdUnit(install), { force: true });
  spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  rmSync(join(install.root, "pispark-start"), { force: true });
}

export function autostartEnabled(install: Install): boolean {
  if (windows) return spawnSync(system32("reg.exe"), ["query", RUN_KEY, "/v", names(install).run], { windowsHide: true, stdio: "ignore" }).status === 0;
  return spawnSync("systemctl", ["--user", "is-enabled", names(install).unit], { stdio: "ignore" }).status === 0;
}

/** Linux: under systemd, the service starts and stops PiSpark. */
export function underSystemd() {
  return !windows && Boolean(process.env.INVOCATION_ID);
}

export function systemd(install: Install, action: "start" | "stop" | "restart") {
  return spawnSync("systemctl", ["--user", action, names(install).unit], { stdio: "ignore" }).status === 0;
}

/**
 * `pispark-start` (Linux): what systemd runs. Outside `versions/`, written by setup, never by an
 * update. If a new launcher was being tried and it is started again before it confirmed itself
 * healthy, the previous version comes back.
 */
export function writeStartScript(install: Install) {
  const file = join(install.root, "pispark-start");
  writeFileSync(
    file,
    `#!/bin/sh
# Written by PiSpark setup; updates never change it. Runs the current version's launcher.
ROOT='${install.root.replace(/'/g, "'\\''")}'
U="$ROOT/update"
if [ -f "$U/trying" ] && [ -f "$U/previous" ]; then
  if [ -f "$U/trying.started" ]; then
    v=$(cat "$U/trying"); p=$(cat "$U/previous")
    ln -sfn "versions/$p" "$ROOT/current.next" && mv -T "$ROOT/current.next" "$ROOT/current"
    echo "$v" >> "$U/failed"; echo "$v" > "$U/rolled-back"
    rm -f "$U/trying" "$U/trying.started"
  else
    : > "$U/trying.started"
  fi
fi
exec "$ROOT/current/node/bin/node" "$ROOT/current/app/apps/launcher/dist/pispark.mjs" run
`,
  );
  chmodSync(file, 0o755);
}

/** The `pispark` command: `~/.local/bin/pispark` on Linux, `<install>\\bin\\pispark.cmd` on Windows. */
export function installCommand(install: Install): string {
  const { exe, args } = launcherCommand(install, "");
  if (windows) {
    const dir = join(install.root, "bin");
    mkdirSync(dir, { recursive: true });
    // The console Node, so the command prints; the windowless one is for login and the tray.
    const node = join(install.current, "node", "node.exe");
    writeFileSync(join(dir, `${names(install).command}.cmd`), `@echo off\r\n"${node}" "${args[0]}" %*\r\n`);
    return dir;
  }
  mkdirSync(binDir(), { recursive: true });
  const file = join(binDir(), names(install).command);
  writeFileSync(file, `#!/bin/sh\nexec "${exe}" "${args[0]}" "$@"\n`);
  chmodSync(file, 0o755);
  return binDir();
}

export function removeCommand(install: Install) {
  if (windows) rmSync(join(install.root, "bin"), { recursive: true, force: true });
  else rmSync(join(binDir(), names(install).command), { force: true });
}

/** Windows: a Start menu entry that opens PiSpark (starting it if needed), with its icon. */
export function addStartMenu(install: Install) {
  if (!windows) return;
  const { exe, args } = launcherCommand(install, "start");
  const icon = join(install.current, "app", "apps", "launcher", "dist", "pispark.ico");
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(startMenu(install))})`,
    `$s.TargetPath = ${q(exe)}`,
    `$s.Arguments = ${q(args.map((a) => `"${a}"`).join(" "))}`,
    `$s.IconLocation = ${q(icon)}`,
    `$s.Description = ${q(names(install).label)}`,
    `$s.Save()`,
  ].join("; ");
  run(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script]);
}

export function removeStartMenu(install: Install) {
  if (windows) rmSync(startMenu(install), { force: true });
}

/** Opens PiSpark's window: Edge as an app window if there is one, otherwise the default browser. */
export function openWindow(address: string) {
  if (windows) {
    const edge = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]
      .filter(Boolean)
      .map((base) => join(base!, "Microsoft", "Edge", "Application", "msedge.exe"))
      .find((file) => existsSync(file));
    if (edge) spawn(edge, [`--app=${address}`], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    else spawn(system32("rundll32.exe"), ["url.dll,FileProtocolHandler", address], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    spawn("xdg-open", [address], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    return true;
  }
  return false;
}

/** Opens a folder in the file manager. */
export function openFolder(folder: string) {
  if (windows) spawn(join(process.env.SystemRoot ?? "C:\\Windows", "explorer.exe"), [folder], { detached: true, stdio: "ignore" }).unref();
  else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) spawn("xdg-open", [folder], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

function run(file: string, args: string[]) {
  const result = spawnSync(file, args, { windowsHide: true, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${file} ${args[0]} failed: ${(result.stderr || result.error?.message || "").trim()}`);
}
