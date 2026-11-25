import type { SessionDoc } from "../../contract/protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";
import type { AgentTarget } from "../../contract/agent-protocol.js";
import type { SafeLogger } from "../logger.js";
import type { AgentStore } from "../agents/store.js";
import type { Session } from "./session.js";
import type { SessionMetadata, SessionStorage } from "./storage.js";
import type { Wake } from "./wakes.js";

/** A new session's request: Ask's, or another session's. */
export type NewSession = { folder?: string; model?: ModelChoice; agent?: string };
/** What a session started by another one, or by a schedule, records of where it came from. */
export type Origin = Pick<SessionMetadata, "parent" | "report" | "title" | "schedule">;

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
}

/** How a session is named to an agent when it has no title yet. */
export const titleOf = (metadata: SessionMetadata) => metadata.title ?? "a session";

/** The session's own layer once it has one, else the agent it started with. */
export const targetOf = (agents: AgentStore, metadata: SessionMetadata): AgentTarget =>
  agents.exists({ session: metadata.id }) ? { session: metadata.id } : { agent: metadata.agent };
