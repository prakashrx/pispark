import type { Command, Receipt } from "../../../../server/src/contract/protocol";
import { commandError, type CommandUncertaintyKind } from "./session-presentation";

/** A command whose outcome is not known: it may or may not have been accepted or settled. */
export class CommandUncertainty extends Error {
  constructor(
    readonly kind: CommandUncertaintyKind,
    detail: string,
    readonly receipt?: Receipt,
    readonly longRunning = false,
  ) {
    super(detail);
  }
}
/**
 * A command the server no longer knows: it keeps a receipt while its command runs and for a while
 * after, so nothing is running for it (PiSpark restarted, or it ended long ago). The session's own
 * state says what became of it.
 */
export class CommandGone extends Error {
  constructor(readonly receipt: Receipt) {
    super("The server no longer knows this command.");
  }
}
/** A request the server answered with an error: its status, and the code and detail it gave. */
export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
    readonly detail?: string,
  ) {
    super(code ?? "Request failed");
  }
}
/** A response larger than the request allowed: refused before it is parsed. */
export class ResponseTooLarge extends Error {
  constructor() {
    super("Response limit");
  }
}
/** A command the server refused or that failed there: its code, said in words. */
export class CommandFailed extends Error {
  constructor(readonly code: string) {
    super(commandError(code));
  }
}
/** How long a JSON request may take and how large its answer may be. */
export interface JsonOptions {
  /** Bytes; 1 MB unless given. */
  limit?: number;
  /** Milliseconds; 12 seconds unless given. */
  timeout?: number;
}

/**
 * A bounded JSON request: the answer is refused past its limit, and the request past its time or when
 * `init.signal` aborts. An error answer throws `RequestFailed`; a removed device reloads the page.
 */
export async function requestJson<T>(path: string, init: RequestInit = {}, { limit = 1024 * 1024, timeout = 12_000 }: JsonOptions = {}): Promise<T> {
  const timer = AbortSignal.timeout(timeout);
  const response = await fetch(path, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timer]) : timer });
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
      if (size > limit) throw new ResponseTooLarge();
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  const result = JSON.parse(text + decoder.decode());
  // A device removed while open: start again, at the pairing screen.
  if (response.status === 401 && result.error === "unpaired") location.reload();
  if (!response.ok)
    throw new RequestFailed(response.status, typeof result.error === "string" ? result.error : undefined, typeof result.detail === "string" ? result.detail : undefined);
  return result as T;
}

export type InputCommand = Command extends infer C ? (C extends Command ? Omit<C, "commandId"> : never) : never;

/**
 * How the browser talks to the server: bounded JSON requests, and commands with their receipts.
 * Nothing here knows about sessions or screens.
 */
export class Transport {
  private readonly controller = new AbortController();
  closed = false;

  /** Ends with the transport; combine it with a request's own signal. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  /** A JSON request that ends with the transport too. */
  json<T>(path: string, init?: RequestInit, options?: JsonOptions): Promise<T> {
    const signals = [this.controller.signal, ...(init?.signal ? [init.signal] : [])];
    return requestJson<T>(path, { ...init, signal: AbortSignal.any(signals) }, options);
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
  /**
   * Waits for an accepted command to settle. One check that fails or takes too long (a phone in
   * the background, a dropped request) is tried again; two in a row make the outcome uncertain. A
   * receipt the server no longer knows is a command that no longer runs.
   */
  async settled(receipt: Receipt, longRunning = false): Promise<Receipt> {
    const started = Date.now();
    const uncertain = (message: string) =>
      new CommandUncertainty("settlement-unknown", `${message}${receipt.sessionId ? ` (session ${receipt.sessionId})` : ""}`, receipt, longRunning);
    let failed = 0;
    while (receipt.state === "accepted") {
      if (this.closed) throw uncertain("Client closed");
      if (!longRunning && Date.now() - started > 310_000) throw uncertain(`Settlement unknown for ${receipt.commandId}; do not automatically retry.`);
      await new Promise((resolve) => setTimeout(resolve, longRunning && Date.now() - started > 5_000 ? 2_000 : 250));
      try {
        receipt = await this.json<Receipt>(`/api/receipts/${receipt.commandId}`);
        failed = 0;
      } catch (error) {
        if (error instanceof RequestFailed && error.code === "unknown-receipt") throw new CommandGone(receipt);
        if (++failed >= 2 || this.closed) throw uncertain((error as Error).message);
      }
    }
    if (receipt.error) throw new CommandFailed(receipt.error);
    return receipt;
  }
  /** A command sent and settled. */
  async run(command: InputCommand): Promise<Receipt> {
    return this.settled(await this.submit(command), command.type === "compact");
  }
  close() {
    this.closed = true;
    this.controller.abort();
  }
}
