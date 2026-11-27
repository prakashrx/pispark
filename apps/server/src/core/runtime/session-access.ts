import type { SessionDoc } from "../../contract/protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import type { AgentDefinition, AgentTarget } from "../../contract/agent-protocol.js";
import type { SafeLogger } from "../logger.js";
import type { AgentStore } from "../agents/store.js";
import type { Session } from "./session.js";
import type { SessionMetadata, SessionStorage } from "./storage.js";
import type { Wake } from "./wakes.js";
import type { Arrival } from "./arrivals.js";

/** A new session's request: Ask's, or another session's, which may bring an agent made for it (`layer`, the session's own layer). */
export type NewSession = { folder?: string; model?: ModelChoice; agent?: string; layer?: AgentDefinition };
/** What a session started by another one, or by a schedule, records of where it came from. */
export type Origin = Pick<SessionMetadata, "parent" | "title" | "schedule" | "ask">;

/**
 * What the runtime lends the parts that work across sessions (child sessions, holds, processes,
 * runs): its storage and agents, its loaded sessions, and the few things it does to them.
 */
export interface SessionAccess {
  readonly storage: SessionStorage;
  readonly agents: AgentStore;
  readonly logger: SafeLogger;
  accepting(): boolean;
  /** Refuses once the runtime is shutting down. */
  admit(): void;
  now(): number;
  /** The loaded session, ready or not. */
  live(id: string): Session | undefined;
  /** The loaded, ready session; "not-found" otherwise. */
  get(id: string): Session;
  /** Loads a session that is not loaded. */
  ensure(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  create(request: NewSession, origin: Origin): Promise<SessionDoc>;
  deliver(sessionId: string, wake: Wake): Promise<void>;
  /** Takes messages that still wait for the session, so they are not sent (see `Wakes.take`). */
  take(sessionId: string, which: (wake: Wake) => boolean): Wake[];
  /** Whether a message from a source still waits for the session. */
  waiting(sessionId: string, sourceId: string): boolean;
  /** The next thing to arrive for a session while it works (see `Arrivals`). */
  arrival(sessionId: string, signal: AbortSignal): Promise<Arrival | undefined>;
  /** Something the session started is still due to wake it: a message waiting for it, or a process still running. */
  pending(sessionId: string): boolean;
  /** Stops the processes a session started, quietly. */
  stopProcesses(sessionId: string): void;
}

/** How a session is named to an agent when it has no title yet. */
export const titleOf = (metadata: SessionMetadata) => metadata.title ?? "a session";

/** The session's own layer once it has one, else the agent it started with. */
export const targetOf = (agents: AgentStore, metadata: SessionMetadata): AgentTarget =>
  agents.exists({ session: metadata.id }) ? { session: metadata.id } : { agent: metadata.agent };
