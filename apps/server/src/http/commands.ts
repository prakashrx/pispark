import { Type, type Static } from "typebox";
import { THINKING_LEVELS } from "../contract/agent-protocol.js";
import type { Command, Receipt } from "../contract/protocol.js";
import { sessionTitle } from "../contract/session-title.js";
import { validAgentId } from "../core/agents/format.js";
import { correlated, requestId, silentLogger, type SafeLogger } from "../core/logger.js";
import { ATTACHMENTS_PER_MESSAGE, validAttachmentName } from "../core/runtime/attachments.js";
import { RuntimeError } from "../core/runtime/errors.js";
import { validChoice } from "../core/runtime/provider-storage.js";
import type { SessionRuntime } from "../core/runtime/session-runtime.js";
import { failure } from "./io.js";
import { Text, Uuid, exact, shaped, type Same } from "./shape.js";

const TEXT_BYTES = 64 * 1024;
const session = { commandId: Uuid, sessionId: Uuid };
const model = Type.Optional(exact({ provider: Type.String(), id: Type.String() }));
const attachments = Type.Optional(Type.Array(Type.String(), { maxItems: ATTACHMENTS_PER_MESSAGE, uniqueItems: true }));
const entryId = Text(64);
/** Every command a client may send: its type, and exactly the keys that type takes. */
const CommandShape = Type.Union([
  exact({ commandId: Uuid, type: Type.Literal("create"), folder: Type.Optional(Text(4096)), model, agent: Type.Optional(Type.String()) }),
  exact({ ...session, type: Type.Enum(["open", "cancel", "stop", "archive", "restore", "delete", "compact", "seen", "allow-hold", "deny-hold", "release-hold"]) }),
  exact({ ...session, type: Type.Literal("fork"), entryId: Type.Optional(entryId) }),
  exact({ ...session, type: Type.Literal("branch"), entryId }),
  exact({ ...session, type: Type.Literal("edit"), entryId, text: Text(), attachments }),
  exact({ ...session, type: Type.Literal("reload"), model }),
  exact({ ...session, type: Type.Literal("rename"), title: Text(4096) }),
  exact({ ...session, type: Type.Literal("configure"), model, thinking: Type.Optional(Type.Enum(THINKING_LEVELS)) }),
  exact({ ...session, type: Type.Enum(["start", "steer", "follow-up"]), text: Text(), attachments }),
  exact({ ...session, type: Type.Literal("answer"), dialogId: Uuid, value: Type.Union([Type.String(), Type.Boolean(), Type.Null()]) }),
]);
true satisfies Same<Static<typeof CommandShape>, Command>;
const shapedCommand = shaped(CommandShape);

/** A command as the client sent it: the shape its type takes, and each value one the runtime can use. */
export function validCommand(value: unknown): Command {
  const c = shapedCommand(value);
  const text = "text" in c ? c.text : c.type === "answer" && typeof c.value === "string" ? c.value : "";
  if (
    ("model" in c && c.model && !validChoice(c.model)) ||
    ("agent" in c && c.agent !== undefined && !validAgentId(c.agent)) ||
    ("attachments" in c && c.attachments && !c.attachments.every(validAttachmentName)) ||
    // Changing nothing is not a change.
    (c.type === "configure" && !c.model && !c.thinking) ||
    (c.type === "rename" && !sessionTitle(c.title)) ||
    Buffer.byteLength(text) > TEXT_BYTES
  )
    throw new RuntimeError("invalid-input");
  return c;
}

interface Entry {
  receipt: Receipt;
  input: string;
  expires: number;
  /** `<session>:cancel` or `<session>:stop`: controls kept apart so ordinary saturation cannot block them. */
  lifecycle?: string;
  start?: boolean;
}

/**
 * Commands and their receipts. A command is accepted at once and runs on; its receipt settles when it
 * ends and is kept ten minutes after, so a client that lost the answer can read it again. Receipts live
 * in memory only: after a restart, unknown does not mean it never ran.
 */
export class Commands {
  private readonly receipts = new Map<string, Entry>();

  constructor(
    private readonly runtime: SessionRuntime,
    private readonly logger: SafeLogger = silentLogger,
  ) {}

  /** A command's receipt while it is kept. */
  receipt(commandId: string): Receipt | undefined {
    this.prune();
    return this.receipts.get(commandId)?.receipt;
  }

  /** Accepts a command (or answers the retained receipt of the same one) and runs it. */
  submit(command: Command): Receipt {
    this.prune();
    const input = JSON.stringify(command);
    const existing = this.receipts.get(command.commandId);
    if (existing) {
      if (existing.input !== input) throw new RuntimeError("invalid-input");
      return existing.receipt;
    }
    const lifecycle = command.type === "cancel" || command.type === "stop" ? `${command.sessionId}:${command.type}` : undefined;
    if (lifecycle) {
      const duplicate = [...this.receipts.values()].find((e) => e.lifecycle === lifecycle && e.receipt.state === "accepted");
      // Return the canonical retained receipt, not an unbounded alias per retry.
      if (duplicate) return { ...duplicate.receipt };
    }
    const pool = [...this.receipts.values()].filter((e) => Boolean(e.lifecycle) === Boolean(lifecycle));
    // A start stays pending while its prompt waits for a turn and runs; there is at most one per session.
    if (pool.length >= (lifecycle ? 32 : 256) || (command.type !== "start" && pool.filter((e) => e.receipt.state === "accepted" && !e.start).length >= 16))
      throw new RuntimeError("limit");
    const receipt: Receipt = { commandId: command.commandId, state: "accepted", ...("sessionId" in command ? { sessionId: command.sessionId } : {}) };
    const entry: Entry = { receipt, input, expires: Infinity, lifecycle, ...(command.type === "start" ? { start: true } : {}) };
    this.receipts.set(command.commandId, entry);
    void correlated({ operationId: requestId() }, () => this.run(command, receipt))
      .catch((error) => {
        receipt.outcome = "failed";
        receipt.error = failure(error);
        // A refusal is the receipt's to tell; a command that broke is the log's too.
        if (!(error instanceof RuntimeError)) this.logger.event("command.failure", { sessionId: receipt.sessionId, outcome: "failed", code: "execution", cause: error }, "error");
      })
      .finally(() => {
        receipt.state = "settled";
        entry.expires = Date.now() + 10 * 60_000;
      });
    return { ...receipt };
  }

  private prune() {
    for (const [id, entry] of this.receipts) if (entry.receipt.state === "settled" && entry.expires < Date.now()) this.receipts.delete(id);
  }

  private async run(command: Command, receipt: Receipt) {
    const runtime = this.runtime;
    switch (command.type) {
      case "create":
        receipt.sessionId = (
          await runtime.create({
            ...(command.folder === undefined ? {} : { folder: command.folder }),
            ...(command.model ? { model: command.model } : {}),
            ...(command.agent ? { agent: command.agent } : {}),
          })
        ).id;
        break;
      case "open":
        await runtime.open(command.sessionId);
        break;
      case "reload":
        if ((await runtime.reload(command.sessionId, command.model)).pending?.reload) receipt.outcome = "queued";
        break;
      case "start":
        // A session is loaded when it is used; nobody opens or stops sessions by hand.
        await runtime.ensure(command.sessionId);
        await settleRun(receipt, () => runtime.start(command.sessionId, command.text, command.attachments));
        break;
      case "edit":
        await settleRun(receipt, () => runtime.edit(command.sessionId, command.entryId, command.text, command.attachments));
        break;
      case "steer":
      case "follow-up":
        receipt.outcome = await runtime.queue(command.sessionId, command.text, command.type, command.attachments);
        break;
      case "compact":
        await runtime.compact(command.sessionId);
        break;
      case "fork":
        receipt.sessionId = await runtime.fork(command.sessionId, command.entryId);
        break;
      case "branch":
        await runtime.branch(command.sessionId, command.entryId);
        break;
      case "cancel":
        await runtime.cancel(command.sessionId);
        break;
      case "stop":
        await runtime.stop(command.sessionId);
        break;
      case "archive":
        await runtime.archive(command.sessionId);
        break;
      case "rename":
        runtime.rename(command.sessionId, command.title);
        break;
      case "seen":
        runtime.seen(command.sessionId);
        break;
      case "configure": {
        const doc = await runtime.configure(command.sessionId, {
          ...(command.model ? { model: command.model } : {}),
          ...(command.thinking ? { thinking: command.thinking } : {}),
        });
        if (doc.pending?.model || doc.pending?.thinking) receipt.outcome = "queued";
        break;
      }
      case "restore":
        runtime.restore(command.sessionId);
        break;
      case "delete":
        runtime.delete(command.sessionId);
        break;
      case "allow-hold":
      case "deny-hold":
        runtime.answerHold(command.sessionId, command.type === "allow-hold");
        break;
      case "release-hold":
        runtime.releaseHold(command.sessionId);
        break;
      case "answer":
        runtime.answer(command.sessionId, command.dialogId, command.value);
        break;
    }
    receipt.outcome ??= "completed";
  }
}

/**
 * A start or an edit: admission is decided before it runs, so a refusal settles the receipt at once (a
 * client clears its draft only when it was accepted); an accepted run settles when it ends.
 */
async function settleRun(receipt: Receipt, admit: () => { completion: Promise<Partial<Receipt>> } | Promise<{ completion: Promise<Partial<Receipt>> }>) {
  let run;
  try {
    run = await admit();
  } catch (error) {
    // Only a refusal is settled here; anything else is the caller's to log.
    if (!(error instanceof RuntimeError)) throw error;
    receipt.state = "settled";
    receipt.outcome = "failed";
    receipt.error = failure(error);
    return;
  }
  Object.assign(receipt, await run.completion);
}
