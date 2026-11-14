import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { RELEASE_CHANNELS, type ReleaseChannel } from "../../server/src/contract/host-protocol.ts";
import { callControl, type ControlStatus } from "./control.ts";
import { Daemon } from "./daemon.ts";
import {
  addStartMenu,
  autostartEnabled,
  disableAutostart,
  enableAutostart,
  installCommand,
  openWindow,
  removeCommand,
  removeStartMenu,
  systemd,
  underSystemd,
  writeStartScript,
} from "./desktop.ts";
import { Install, ensureWindowless, ownRelease, windows, type Release } from "./install.ts";

const HELP = `pispark: runs PiSpark in the background and keeps it up to date.

  pispark start       start PiSpark if it is not running, and open it
  pispark open        open PiSpark's window
  pispark status      whether it is running, its version and address
  pispark stop        stop PiSpark
  pispark restart     restart PiSpark's server
  pispark update      check for an update and install it now
  pispark install <version>
                      install that version (older or newer, any channel) and keep it there;
                      resume updates in Settings → About
  pispark logs        where the logs are, and the end of the server log
  pispark uninstall   remove PiSpark (keeps your data; --purge removes it too)

  pispark setup       used by the installer: --channel stable|latest --port <n> [--home <folder>]
                      [--keep] [--no-autostart] [--no-start] [--no-open]`;

function flag(args: string[], name: string) {
  return args.includes(`--${name}`);
}
function option(args: string[], name: string) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function located(): { release: Release; install: Install } {
  const release = ownRelease();
  const install = release && Install.of(release);
  if (!release || !install) {
    console.error("This copy of the launcher is not part of an installed release (versions/<version>/).");
    process.exit(2);
  }
  return { release, install };
}

async function status(install: Install) {
  return callControl<ControlStatus>(install.root, { cmd: "status" });
}

/** Starts the launcher in the background (detached, without a window) and waits until it answers. */
async function startBackground(install: Install, release: Release): Promise<ControlStatus | undefined> {
  if (underSystemdInstalled(install)) systemd("start");
  else spawn(release.windowless, [release.launcher, "run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  const until = Date.now() + 40_000;
  while (Date.now() < until) {
    const s = await status(install);
    if (s && s.server === "running") return s;
    await new Promise((done) => setTimeout(done, 500));
  }
  return status(install);
}

/** Linux with the systemd service set up: systemd starts and stops PiSpark. */
function underSystemdInstalled(_install: Install) {
  return !windows && autostartEnabled();
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function setup(args: string[]) {
  const { release, install } = located();
  const channelInput = option(args, "channel") ?? release.info.channel;
  if (!RELEASE_CHANNELS.includes(channelInput as ReleaseChannel)) throw new Error("--channel must be stable or latest");
  // Repair or reinstall: stop what runs first.
  if (await status(install)) {
    await callControl(install.root, { cmd: "stop" });
    await new Promise((done) => setTimeout(done, 1500));
  }
  let port = Number(option(args, "port") ?? install.choices().port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be a number from 1 to 65535");
  if (!option(args, "port")) while (!(await portFree(port)) && port < 65535) port++;
  const home = option(args, "home");
  const releases = process.env.PISPARK_RELEASES_URL;
  install.choose({
    channel: channelInput as ReleaseChannel,
    port,
    ...(home ? { home } : {}),
    ...(releases ? { releases } : {}),
    // Installed as a specific version: kept there until updates are resumed.
    kept: flag(args, "keep") ? release.info.version : undefined,
  });
  ensureWindowless(release);
  install.point(release.info.version);
  const bin = installCommand(install);
  if (!flag(args, "no-autostart")) {
    try {
      enableAutostart(install);
    } catch (error) {
      if (windows) throw error;
      // No systemd user manager (a container, or WSL without systemd): no start at login.
      writeStartScript(install);
      console.log(`Could not set up the systemd user service (${(error as Error).message}). PiSpark will not start at login; start it with: pispark start`);
    }
    addStartMenu(install);
  } else if (!windows) writeStartScript(install);
  console.log(`PiSpark ${release.info.version} installed in ${install.root}`);
  console.log(`  channel ${channelInput}, address http://127.0.0.1:${port}`);
  console.log(`  the pispark command: ${bin}`);
  if (flag(args, "no-start")) return;
  const s = await startBackground(install, release);
  if (s?.server !== "running") {
    console.error(`PiSpark did not start. See ${join(install.logs, "server.log")}`);
    process.exit(1);
  }
  console.log(`PiSpark is running at ${s.address}`);
  if (!flag(args, "no-open") && !openWindow(s.address)) console.log(`Open ${s.address} in your browser.`);
}

async function uninstall(args: string[]) {
  const { install } = located();
  if (underSystemdInstalled(install)) systemd("stop");
  if (await status(install)) {
    await callControl(install.root, { cmd: "stop" });
    await new Promise((done) => setTimeout(done, 2000));
  }
  disableAutostart(install);
  removeStartMenu();
  removeCommand(install);
  const home = install.choices().home;
  console.log(`Removing ${install.root}`);
  if (flag(args, "purge")) {
    const data = home ?? join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pispark");
    console.log(`Removing your data in ${data}`);
    rmSync(data, { recursive: true, force: true });
  } else console.log("Your data (chats, personas, settings) is kept.");
  if (windows) {
    // This program runs from the folder being removed: remove it once it has exited.
    const cmd = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    spawn(cmd, ["/d", "/c", `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${install.root}"`], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else rmSync(install.root, { recursive: true, force: true });
}

async function main(args: string[]) {
  const [command = "help", ...rest] = args;
  switch (command) {
    case "run": {
      const { release, install } = located();
      await new Daemon(install, release).run();
      return;
    }
    case "start": {
      const { release, install } = located();
      const s = (await status(install)) ?? (await startBackground(install, release));
      if (!s) {
        console.error(`PiSpark did not start. See ${join(install.logs, "launcher.log")}`);
        process.exit(1);
      }
      if (!flag(rest, "no-open") && !openWindow(s.address)) console.log(`PiSpark is running at ${s.address}`);
      return;
    }
    case "open": {
      const { install } = located();
      if (!(await callControl(install.root, { cmd: "open" }))) {
        console.error("PiSpark is not running. Start it with: pispark start");
        process.exit(1);
      }
      return;
    }
    case "status": {
      const { release, install } = located();
      const s = await status(install);
      if (!s) {
        console.log(`PiSpark ${release.info.version} is not running. (${install.root})`);
        process.exit(3);
      }
      console.log(`PiSpark ${s.version}: ${s.server} at ${s.address} (launcher pid ${s.pid}, channel ${install.choices().channel})`);
      return;
    }
    case "stop": {
      const { install } = located();
      if (underSystemdInstalled(install) && systemd("stop")) return void console.log("Stopped.");
      if (!(await callControl(install.root, { cmd: "stop" }))) return void console.log("PiSpark is not running.");
      console.log("Stopping.");
      return;
    }
    case "restart": {
      const { install } = located();
      if (!(await callControl(install.root, { cmd: "restart" }))) return void console.log("PiSpark is not running.");
      console.log("Restarting the server.");
      return;
    }
    case "update": {
      const { install } = located();
      const result = await callControl<{ phase: string; version?: string; message?: string }>(install.root, { cmd: "update" }, 20 * 60_000);
      if (!result) return void console.log("PiSpark is not running. Start it with: pispark start");
      if (result.phase === "current") console.log("PiSpark is up to date.");
      else if (result.phase === "error") console.log(`Update failed: ${result.message}`);
      else console.log(`Update: ${result.phase}${result.version ? ` ${result.version}` : ""}`);
      return;
    }
    case "install": {
      const { install } = located();
      const version = rest[0]?.replace(/^v/, "");
      if (!version) return void console.log("Which version? pispark install <version>, e.g. pispark install 0.2.0");
      console.log(`Installing PiSpark ${version}…`);
      const result = await callControl<{ phase: string; version?: string; reason?: string; message?: string; kept?: string }>(install.root, { cmd: "install", version }, 30 * 60_000);
      if (!result) return void console.log("PiSpark is not running, or it restarted into another launcher. Check with: pispark status");
      if (result.kept) console.log(`PiSpark ${result.kept} is running and kept there. Resume updates in Settings → About.`);
      else if (result.phase === "failed") console.log(`${version} did not start (${result.reason}). PiSpark went back to the version before.`);
      else console.log(`Install: ${result.phase}${result.message ? ` (${result.message})` : ""}`);
      return;
    }
    case "logs": {
      const { install } = located();
      console.log(`Logs: ${install.logs}`);
      const file = join(install.logs, "server.log");
      if (existsSync(file)) console.log(readFileSync(file, "utf8").split(/\r?\n/).slice(-40).join("\n"));
      return;
    }
    case "setup":
      return setup(rest);
    case "uninstall":
      return uninstall(rest);
    default:
      console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
