/**
 * The installed PiSpark: its version, where it runs, and its updates. The launcher (`apps/launcher`)
 * runs the server as its child and owns updates; the server passes its state to the browser and the
 * browser's requests to it. A server started any other way (`npm start`, dev) is not managed.
 */
export const RELEASE_CHANNELS = ["stable", "latest"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

/** Where an update stands. */
export type UpdateState =
  /** Not checked since the launcher started. */
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "current"; checkedAt: string }
  | { phase: "downloading"; version: string; received: number; total?: number }
  /** Downloaded, checked and unpacked; nothing running was touched. */
  | { phase: "ready"; version: string; notes?: string }
  /** Asked to update when nothing is running. */
  | { phase: "waiting"; version: string }
  | { phase: "restarting"; version: string }
  /** The new version did not start; the previous one runs again and this one is not offered again. */
  | { phase: "failed"; version: string; reason: string; at: string }
  /** Checking or downloading failed; tried again at the next check. */
  | { phase: "error"; message: string; at: string };

/** What the launcher tells the server about itself, whenever it changes. */
export interface LauncherStatus {
  version: string;
  channel: ReleaseChannel;
  autoUpdate: boolean;
  update: UpdateState;
  program: string;
  logs: string;
  startsAtLogin: boolean;
}

export interface HostStatus {
  /** Run by the launcher. Not managed: no updates here. */
  managed: boolean;
  version: string;
  address: string;
  data: string;
  launcher?: Omit<LauncherStatus, "version">;
  /** What would be interrupted by a restart now. */
  running: RunningWork;
}

export interface RunningWork {
  /** Chats with a reply in progress (or waiting for an answer or a run slot). */
  replies: { session: string; title: string }[];
  /** Background processes, which end with the server. */
  processes: { session: string; title: string; name: string }[];
}

export type HostAction =
  | { action: "check" }
  | { action: "apply"; when: "idle" | "now" }
  | { action: "cancel" }
  | { action: "configure"; channel?: ReleaseChannel; autoUpdate?: boolean };

/** Launcher to server, over Node's parent–child channel. */
export type LauncherMessage =
  | { type: "status"; status: LauncherStatus }
  /** Shut down gracefully and exit (Windows has no SIGTERM for a child). */
  | { type: "shutdown" }
  | { type: "running?"; id: number };

/** Server to launcher. */
export type ServerMessage =
  | { type: "action"; action: HostAction }
  | { type: "running"; id: number; running: RunningWork };

export function validHostAction(value: unknown): HostAction | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  const only = (...allowed: string[]) => keys.every((k) => allowed.includes(k));
  switch (v.action) {
    case "check":
    case "cancel":
      return only("action") ? { action: v.action } : undefined;
    case "apply":
      return only("action", "when") && (v.when === "idle" || v.when === "now") ? { action: "apply", when: v.when } : undefined;
    case "configure": {
      if (!only("action", "channel", "autoUpdate")) return;
      if (v.channel !== undefined && !RELEASE_CHANNELS.includes(v.channel as ReleaseChannel)) return;
      if (v.autoUpdate !== undefined && typeof v.autoUpdate !== "boolean") return;
      return {
        action: "configure",
        ...(v.channel !== undefined ? { channel: v.channel as ReleaseChannel } : {}),
        ...(v.autoUpdate !== undefined ? { autoUpdate: v.autoUpdate as boolean } : {}),
      };
    }
  }
}

/** Compares versions such as `0.4.2` and `0.4.3-main.202611141842` (semver order; a release beats its prereleases). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.replace(/^v/, "").split("-", 2) as [string, string | undefined];
    return { core: core.split(".").map((n) => Number(n) || 0), pre: pre?.split(".") };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.core[i] ?? 0) !== (y.core[i] ?? 0)) return (x.core[i] ?? 0) - (y.core[i] ?? 0);
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
