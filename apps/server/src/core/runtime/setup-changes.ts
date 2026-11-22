import type { ThinkingLevel } from "../../contract/agent-protocol.js";
import type { PendingSetup } from "../../contract/protocol.js";
import type { ModelChoice } from "../../contract/provider-protocol.js";

/**
 * A change to what a session runs. Asked for while the session works, it waits, and is applied with
 * any others once the session is free (`SessionRuntime.applySetup`): model and thinking through Pi,
 * anything else by one reload, which starts the session again from its transcript.
 */
export interface SetupChange {
  model?: ModelChoice;
  thinking?: ThinkingLevel;
  /** The person asked for a reload. */
  reload?: true;
  /** A staged extension revision for the reload to activate or unload. */
  extension?: string;
  /**
   * Asked for from inside the session, by its agent or an extension: a reload, and what was asked
   * for, so the session can be woken with the outcome and carry on.
   */
  asked?: string;
}

/** What waits for one session: the latest model and thinking, and everything that asked for a reload. */
export interface Waiting {
  model?: ModelChoice;
  thinking?: ThinkingLevel;
  reload: boolean;
  extension?: string;
  asked: string[];
}

/** The changes waiting for each session until it is free. */
export class SetupChanges {
  private readonly waiting = new Map<string, Waiting>();

  /** Adds a change to what waits; refused (false) when another extension revision already waits. */
  add(sessionId: string, change: SetupChange): boolean {
    const now = this.waiting.get(sessionId) ?? { reload: false, asked: [] };
    if (change.extension && now.extension && change.extension !== now.extension) return false;
    this.waiting.set(sessionId, {
      model: change.model ?? now.model,
      thinking: change.thinking ?? now.thinking,
      reload: now.reload || !!change.reload,
      extension: change.extension ?? now.extension,
      asked: change.asked && !now.asked.includes(change.asked) ? [...now.asked, change.asked] : now.asked,
    });
    return true;
  }
  /** Puts back what was taken but could not be applied yet, under anything asked for since. */
  restore(sessionId: string, waiting: Waiting): void {
    const since = this.waiting.get(sessionId);
    this.waiting.set(sessionId, {
      model: since?.model ?? waiting.model,
      thinking: since?.thinking ?? waiting.thinking,
      reload: waiting.reload || !!since?.reload,
      extension: since?.extension ?? waiting.extension,
      asked: [...new Set([...waiting.asked, ...(since?.asked ?? [])])],
    });
  }
  has(sessionId: string): boolean {
    return this.waiting.has(sessionId);
  }
  extension(sessionId: string): string | undefined {
    return this.waiting.get(sessionId)?.extension;
  }
  /** What clients show: the model and thinking to come, and whether the session will reload. */
  view(sessionId: string): PendingSetup | undefined {
    const waiting = this.waiting.get(sessionId);
    if (!waiting) return undefined;
    return {
      ...(waiting.model ? { model: { ...waiting.model } } : {}),
      ...(waiting.thinking ? { thinking: waiting.thinking } : {}),
      ...(reloads(waiting) ? { reload: true as const } : {}),
    };
  }
  /** Takes what waits, to apply it. */
  take(sessionId: string): Waiting | undefined {
    const waiting = this.waiting.get(sessionId);
    this.waiting.delete(sessionId);
    return waiting;
  }
  forget(sessionId: string): void {
    this.waiting.delete(sessionId);
  }
}

/** Whether what waits needs a reload, rather than only another model or thinking level. */
export const reloads = (waiting: Waiting) => waiting.reload || !!waiting.extension || waiting.asked.length > 0;
