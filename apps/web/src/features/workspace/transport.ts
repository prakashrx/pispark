import type { Command, Receipt } from "../../../../server/src/contract/protocol";
import { commandError, type CommandUncertaintyKind } from "./session-presentation";

/** A command whose outcome is not known: it may or may not have been accepted or settled. */
export class CommandUncertainty extends Error {
  constructor(
    readonly kind: CommandUncertaintyKind,
    detail: string,
  ) {
    super(detail);
  }
}
/** A command the server refused or that failed there: its code, said in words. */
export class CommandFailed extends Error {
  constructor(readonly code: string) {
    super(commandError(code));
  }
}
export type InputCommand = Command extends infer C ? (C extends Command ? Omit<C, "commandId"> : never) : never;

/**
 * How the browser talks to the server: bounded JSON requests, and commands with their receipts.
 * Nothing here knows about chats or screens.
 */
export class Transport {
  private readonly controller = new AbortController();
  closed = false;

  /** Ends with the transport; combine it with a request's own signal. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  async json<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(12_000)]),
    });
    // The host bounds every response. Refuse unexpectedly large payloads before JSON parsing too.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No server response");
    let text = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error("Response limit");
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel();
    }
    const result = JSON.parse(text + decoder.decode());
    if (!response.ok) throw new Error(result.error ?? "Request failed");
    return result as T;
  }
  /** Sends a command once. A lost answer is uncertainty, never a reason to send it again. */
  async submit(command: InputCommand): Promise<Receipt> {
    const commandId = crypto.randomUUID();
    try {
      return await this.json<Receipt>("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...command, commandId }),
      });
    } catch (error) {
      throw new CommandUncertainty(
        "acceptance-unknown",
        `Command ${commandId}: ${(error as Error).message}. Acceptance unknown; inspect session before sending again.`,
      );
    }
  }
  /** Waits for an accepted command to settle. */
  async settled(receipt: Receipt): Promise<Receipt> {
    const until = Date.now() + 310_000;
    while (receipt.state === "accepted") {
      try {
        if (this.closed) throw new Error("Client closed");
        if (Date.now() > until) throw new Error(`Settlement unknown for ${receipt.commandId}; do not automatically retry.`);
        await new Promise((resolve) => setTimeout(resolve, 250));
        receipt = await this.json<Receipt>(`/api/receipts/${receipt.commandId}`);
      } catch (error) {
        throw new CommandUncertainty(
          "settlement-unknown",
          `${(error as Error).message}${receipt.sessionId ? ` (chat ${receipt.sessionId})` : ""}`,
        );
      }
    }
    if (receipt.error) throw new CommandFailed(receipt.error);
    return receipt;
  }
  /** A command sent and settled. */
  async run(command: InputCommand): Promise<Receipt> {
    return this.settled(await this.submit(command));
  }
  close() {
    this.closed = true;
    this.controller.abort();
  }
}
