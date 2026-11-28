import { switchName } from "../../contract/agent-protocol.js";
import { resolveSetup, unattendedOf } from "../agents/resolve.js";
import { validateId, type SessionMetadata } from "./storage.js";
import { extensionName, type Session } from "./session.js";
import { RuntimeError, runtimeError } from "./errors.js";
import { targetOf, type SessionAccess } from "./session-access.js";

/**
 * An extension keeping its session loaded while no one watches (`hold:<extension>`): asked by the
 * extension, allowed by the agent or the person, let go by either. Paused with all unattended work.
 */
export class Holds {
  constructor(
    private readonly sessions: SessionAccess,
    private readonly paused: () => boolean,
  ) {}

  /** Whether a session is kept loaded now: held, and not while unattended work is paused. */
  holding(metadata: SessionMetadata): boolean {
    return !!metadata.held && !this.paused();
  }

  /**
   * An extension asks to keep its session loaded (or lets go). Allowed by the agent, it is held at
   * once; otherwise the person is asked in the session (`holdAsked`) and the extension told so.
   */
  request(session: Session, request: { extension: string; hold: boolean; reason: string }) {
    const { storage } = this.sessions;
    const metadata = session.metadata;
    if (!request.hold) {
      if (session.holdAsked?.extension === request.extension) session.holdAsked = undefined;
      if (metadata.held?.extension === request.extension) {
        delete metadata.held;
        storage.write(metadata);
      }
      session.changed();
      return { state: "released" as const, text: "Released: the session unloads when it is idle." };
    }
    if (!this.extensionsOf(metadata).includes(request.extension))
      return { state: "refused" as const, text: `This session has no extension called "${request.extension}".` };
    if (metadata.held && metadata.held.extension !== request.extension)
      return { state: "refused" as const, text: `"${metadata.held.extension}" already keeps this session loaded.` };
    if (!this.allowed(metadata, request.extension)) {
      session.holdAsked = { extension: request.extension, reason: request.reason };
      session.changed();
      return { state: "asked" as const, text: "The person is asked to allow it; until then the session unloads when idle." };
    }
    session.holdAsked = undefined;
    metadata.held = { extension: request.extension, reason: request.reason };
    storage.write(metadata);
    session.changed();
    return { state: "held" as const, text: "Held: the session stays loaded while no one watches, and is loaded again after a restart." };
  }

  /**
   * The person answers a hold request: allowing it switches `hold:<extension>` on in the agent
   * (so its other sessions may hold too) and holds this session; "Not now" forgets the request.
   */
  answer(id: string, allow: unknown): void {
    if (typeof allow !== "boolean") throw new RuntimeError("invalid-input");
    const session = this.sessions.get(id);
    const asked = session.holdAsked;
    if (!asked) throw new RuntimeError("not-found");
    session.holdAsked = undefined;
    if (allow) {
      this.sessions.agents.setSwitch(session.metadata.agent, switchName("hold", asked.extension), true);
      session.metadata.held = { ...asked };
      this.sessions.storage.write(session.metadata);
    }
    session.changed();
  }

  /** The person lets go of a hold: the session unloads when idle. The agent still allows it. */
  release(id: string): void {
    validateId(id);
    const session = this.sessions.live(id);
    const metadata = session?.metadata ?? this.sessions.storage.read(id);
    if (!metadata.held) return;
    delete metadata.held;
    this.sessions.storage.write(metadata);
    session?.changed();
  }

  /**
   * Held sessions as they should be: loaded (after a restart, or when Pause all ends), unloaded while
   * paused, and let go once their agent no longer allows it.
   */
  async keep(): Promise<void> {
    const { storage, accepting, live, stop, ensure, logger } = this.sessions;
    for (const metadata of storage.list()) {
      if (!metadata.held || metadata.archived || !accepting()) continue;
      const session = live(metadata.id);
      if (!this.allowed(metadata, metadata.held.extension)) {
        const { held: _held, ...kept } = session?.metadata ?? metadata;
        if (session) delete session.metadata.held;
        storage.write(session?.metadata ?? kept);
        session?.changed();
        continue;
      }
      try {
        if (this.paused()) {
          if (session?.settled && session.observers.size === 0) await stop(metadata.id);
        } else if (!session) await ensure(metadata.id);
      } catch (error) {
        logger.event("wake.failure", { sessionId: metadata.id, outcome: "failed", code: runtimeError(error, "execution").code, cause: error });
      }
    }
  }

  /** The extension names a session's agent loads. */
  private extensionsOf(metadata: SessionMetadata): string[] {
    try {
      return resolveSetup(this.sessions.agents, targetOf(this.sessions.agents, metadata)).extensionPaths.map(extensionName);
    } catch {
      return [];
    }
  }

  /** Whether the session's agent allows the extension to hold (`hold:<extension>`). */
  private allowed(metadata: SessionMetadata, extension: string): boolean {
    try {
      return unattendedOf(this.sessions.agents, targetOf(this.sessions.agents, metadata)).holds.includes(extension);
    } catch {
      return false;
    }
  }
}
