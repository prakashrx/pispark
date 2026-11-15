import { spawn } from "node:child_process";
import { join } from "node:path";
import type { TailscaleState } from "../../contract/remote-protocol.js";

/** What Tailscale said when asked to serve. */
export type ServeResult =
  | { ok: true }
  /** Serve isn't switched on for the tailnet; Tailscale names the admin page that does it. */
  | { ok: false; enableUrl: string }
  | { ok: false; error: string };

export interface TailscaleInfo {
  state: TailscaleState;
  /** This computer's MagicDNS name, e.g. `desktop.tail1234.ts.net`; Serve needs it. */
  dnsName?: string;
}

/** The parts of the Tailscale CLI remote access uses. Replaced in tests. */
export interface TailscaleCli {
  info(): Promise<TailscaleInfo>;
  /** Tailscale serves `https://<dnsName>:<httpsPort>` as a proxy to `target`. */
  serving(dnsName: string, httpsPort: number, target: string): Promise<boolean>;
  serve(httpsPort: number, target: string): Promise<ServeResult>;
  /** Stops serving that HTTPS port. Serving it already stopped is not an error. */
  stop(httpsPort: number): Promise<void>;
}

interface Run {
  code: number | null;
  out: string;
}
const ENABLE_URL = /https:\/\/login\.tailscale\.com\/f\/serve\?node=[\w-]+/;
/** A short, single-line account of what the CLI said, for the page. */
const said = (out: string) => out.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 200) ?? "Tailscale didn’t say why.";

/**
 * The `tailscale` command on this computer: from PATH, or where the installers put it. PiSpark only
 * runs it; it never installs or signs in to Tailscale.
 */
export class Tailscale implements TailscaleCli {
  private found?: string;
  private candidates(): string[] {
    const list = ["tailscale"];
    if (process.platform === "win32") list.push(join(process.env.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe"));
    if (process.platform === "darwin") list.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    return list;
  }

  /**
   * Runs the CLI with arguments (never through a shell). `until` ends it early when its output
   * matches, for commands that wait on something only a person can do.
   */
  private run(args: string[], timeout = 10_000, until?: RegExp): Promise<Run | undefined> {
    const attempt = (command: string) =>
      new Promise<Run | "missing">((resolve) => {
        let out = "";
        let done = false;
        const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const finish = (result: Run | "missing") => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          child.kill();
          finish({ code: null, out });
        }, timeout);
        const read = (chunk: Buffer) => {
          if (out.length < 1024 * 1024) out += chunk.toString("utf8");
          if (until?.test(out)) {
            child.kill();
            finish({ code: null, out });
          }
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        child.on("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT" ? "missing" : { code: null, out: error.message }));
        child.on("close", (code) => finish({ code, out }));
      });
    return (async () => {
      for (const command of this.found ? [this.found] : this.candidates()) {
        const result = await attempt(command);
        if (result === "missing") continue;
        this.found = command;
        return result;
      }
      this.found = undefined;
      return undefined;
    })();
  }

  async info(): Promise<TailscaleInfo> {
    const result = await this.run(["status", "--json"]);
    if (!result) return { state: { state: "missing" } };
    try {
      const status = JSON.parse(result.out) as {
        BackendState?: string;
        Self?: { DNSName?: string; HostName?: string; UserID?: number };
        User?: Record<string, { LoginName?: string }>;
      };
      if (status.BackendState !== "Running" || !status.Self) return { state: { state: "stopped" } };
      const dnsName = status.Self.DNSName?.replace(/\.$/, "") || undefined;
      return {
        state: {
          state: "ready",
          account: status.User?.[String(status.Self.UserID)]?.LoginName ?? "",
          machine: dnsName?.split(".")[0] ?? status.Self.HostName ?? "",
        },
        ...(dnsName && /^[a-z0-9.-]+$/i.test(dnsName) ? { dnsName: dnsName.toLowerCase() } : {}),
      };
    } catch {
      // Not running: `status --json` prints a message instead of JSON.
      return { state: { state: "stopped" } };
    }
  }

  async serving(dnsName: string, httpsPort: number, target: string): Promise<boolean> {
    const result = await this.run(["serve", "status", "--json"]);
    if (!result || result.code !== 0) return false;
    try {
      const config = JSON.parse(result.out) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
      const proxy = config.Web?.[`${dnsName}:${httpsPort}`]?.Handlers?.["/"]?.Proxy;
      return proxy?.replace(/\/$/, "") === target;
    } catch {
      return false;
    }
  }

  async serve(httpsPort: number, target: string): Promise<ServeResult> {
    // When Serve isn't allowed on the tailnet, Tailscale prints the admin link and waits; it is ended there.
    // Within the browser's 12 s wait for an answer.
    const result = await this.run(["serve", "--bg", "--yes", `--https=${httpsPort}`, target], 9_000, ENABLE_URL);
    if (!result) return { ok: false, error: "Tailscale isn’t installed." };
    const enableUrl = ENABLE_URL.exec(result.out)?.[0];
    if (enableUrl) return { ok: false, enableUrl };
    if (result.code === 0) return { ok: true };
    return { ok: false, error: result.code === null ? "Tailscale didn’t answer in time." : said(result.out) };
  }

  async stop(httpsPort: number): Promise<void> {
    const result = await this.run(["serve", `--https=${httpsPort}`, "off"]);
    if (result && result.code !== 0 && !/does not exist/i.test(result.out)) throw new Error(said(result.out));
  }
}
