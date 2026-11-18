import type { SessionInfo } from "../../../../server/src/contract/protocol";
import { validSessionTitle } from "../../../../server/src/contract/session-title";

export type CommandUncertaintyKind =
  | "acceptance-unknown"
  | "settlement-unknown";
export function commandUncertainty(
  kind: CommandUncertaintyKind | undefined,
  hasSession: boolean,
): string {
  const target = hasSession ? "this session" : "your sessions";
  if (kind === "acceptance-unknown")
    return `We couldn’t confirm whether that action went through. Check ${target} before trying again.`;
  if (kind === "settlement-unknown")
    return `That action may still be running. Check ${target} before trying again.`;
  return "";
}

/** What the server's code for a refused or failed command means, in words. */
const COMMAND_ERRORS: Record<string, string> = {
  folder: "That working folder doesn’t exist on the server.",
  agent: "That agent can’t be used: it is missing or can’t be resolved. Check it under Agents.",
  busy: "The session is busy. Try again when it has finished.",
  "not-found": "That session isn’t open on the server.",
  storage: "Couldn’t read or save on the server.",
  execution: "The run failed on the server.",
  timeout: "The server took too long to answer.",
  closed: "The server is shutting down.",
  "read-only": "This session can only be read: its model, agent or folder can’t be used.",
};
export const commandError = (code: string): string => COMMAND_ERRORS[code] ?? `The server could not do that (${code}).`;

/** Last segment of a host path, for compact labels: "D:\\dev\\pispark" → "pispark". */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** A duration as people say it: "8s", "1m 42s", "2h 5m". */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Sessions by when they last did something: Today, Yesterday, This week, Older; empty groups left out. */
export function dateGroups<T extends { lastActivity: string }>(sessions: T[], now = new Date()): { label: string; items: T[] }[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  const groups = [
    { label: "Today", from: today, items: [] as T[] },
    { label: "Yesterday", from: yesterday, items: [] as T[] },
    { label: "This week", from: week, items: [] as T[] },
    { label: "Older", from: new Date(0), items: [] as T[] },
  ];
  for (const session of sessions) {
    const active = new Date(session.lastActivity);
    (groups.find((group) => active >= group.from) ?? groups.at(-1)!).items.push(session);
  }
  return groups.filter((group) => group.items.length).map(({ label, items }) => ({ label, items }));
}

/** An app's session with no title of its own goes by the app's name. */
export const goesByApp = (session: SessionInfo): boolean => !!session.agent?.home && !validSessionTitle(session.title);
export function sessionName(session?: SessionInfo): string {
  if (!session) return "This session";
  if (validSessionTitle(session.title)) return session.title;
  if (goesByApp(session)) return session.agent.name;
  if (session.hasHistory === false) return "New session";
  return "Untitled session";
}

/** A session's state, one of the shared status marks (design language §3.1); "" when idle. */
export type SessionState = "needs-you" | "failed" | "working" | "queued" | "opening" | "stopping" | "";
/** The words for each state, the same everywhere: list, header, details, notifications. */
export const STATE_WORDS: Record<Exclude<SessionState, "">, string> = {
  "needs-you": "Needs you",
  failed: "Failed",
  working: "Working",
  queued: "Queued",
  opening: "Opening",
  stopping: "Stopping",
};
type StateFields = Pick<SessionInfo, "status" | "interrupted" | "waiting" | "queued">;
export function sessionState(session?: StateFields): SessionState {
  const status = session?.status;
  if (session?.waiting && status === "running") return "needs-you";
  if (session?.queued || status === "queued") return "queued";
  if (status === "cancelling" || status === "stopping") return "stopping";
  if (status === "running") return "working";
  if (status === "starting") return "opening";
  if (session?.interrupted || status === "error") return "failed";
  return "";
}
/** A session's state in words; empty when there is nothing to say. */
export function sessionStatus(session?: StateFields): string {
  const state = sessionState(session);
  return state ? STATE_WORDS[state] : "";
}
/** A session is put away only while nothing runs, waits or is queued in it. */
export const canArchive = (session: Pick<SessionInfo, "status" | "waiting" | "queued">): boolean =>
  ["idle", "error", "unloaded", "read-only"].includes(session.status) && !session.waiting && !session.queued;
/** Of several sessions' states, the one a person most needs to see. */
const FOREMOST: SessionState[] = ["needs-you", "failed", "working", "queued", "opening", "stopping"];
export function foremostState(states: SessionState[]): SessionState {
  return FOREMOST.find((state) => states.includes(state)) ?? "";
}

/** When a session started: "12 Nov, 9:34 pm", with the year when it is not this year's. */
export function sessionStarted(session: SessionInfo): string {
  const date = new Date(session.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A model's name from the providers' catalog, or its id when the catalog doesn't list it. */
/** Thinking levels in words. */
export const THINKING_WORDS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};
/** "400k", "1.2M": a context window's size, short. */
export function tokensShort(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0M", "M");
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}
/** "38% of 400k", or the window alone while it isn't measured (right after a summary). */
export function contextText(context: { percent: number | null; window: number }): string {
  return context.percent === null ? `${tokensShort(context.window)} window` : `${Math.round(context.percent)}% of ${tokensShort(context.window)}`;
}
export function modelName(
  providers: { id: string; models: { id: string; name: string }[] }[],
  model?: { provider: string; id: string },
): string | undefined {
  if (!model) return undefined;
  return providers.find((p) => p.id === model.provider)?.models.find((m) => m.id === model.id)?.name ?? model.id;
}
