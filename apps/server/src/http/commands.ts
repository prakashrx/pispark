import type { Command, Receipt } from "../contract/protocol.js";
import { sessionTitle } from "../contract/session-title.js";
import { validAgentId } from "../core/agents/format.js";
import { correlated, requestId } from "../core/logger.js";
import { ATTACHMENTS_PER_MESSAGE, validAttachmentName } from "../core/runtime/attachments.js";
import { RuntimeError } from "../core/runtime/errors.js";
import { validChoice } from "../core/runtime/provider-storage.js";
import type { SessionRuntime } from "../core/runtime/session-runtime.js";
import { UUID, failure } from "./io.js";

/** The keys a command may carry besides `commandId` and `type`; undefined: no such command. */
function keysOf(c: Record<string, unknown>): string[] | undefined {
  const optional = (...names: string[]) => names.filter((name) => c[name] !== undefined);
  switch (c.type) {
    case "create":
      return optional("folder", "model", "agent");
    case "reload":
      return ["sessionId", ...optional("model")];
    case "open":
    case "cancel":
    case "stop":
    case "archive":
    case "restore":
    case "delete":
    case "compact":
    case "allow-hold":
    case "deny-hold":
    case "release-hold":
    case "seen":
      return ["sessionId"];
    case "fork":
      return ["sessionId", ...optional("entryId")];
    case "branch":
      return ["sessionId", "entryId"];
    case "edit":
      return ["sessionId", "entryId", "text", ...optional("attachments")];
    case "rename":
      return ["sessionId", "title"];
    case "configure":
      return ["sessionId", ...optional("model", "thinking")];
    case "start":
    case "steer":
    case "follow-up":
      return ["sessionId", "text", ...optional("attachments")];
    default:
      return undefined;
  }
}

/** A command as the client sent it: the exact keys its type allows, each of its kind and bounds. */
export function validCommand(value: unknown): Command {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("invalid-input");
  const c = value as Record<string, unknown>;
  if (typeof c.type !== "string" || typeof c.commandId !== "string" || !UUID.test(c.commandId)) throw new RuntimeError("invalid-input");
  if (c.type === "answer") return validAnswer(c);
  const keys = keysOf(c);
  if (!keys || Object.keys(c).length !== keys.length + 2 || Object.keys(c).some((key) => !["commandId", "type", ...keys].includes(key)))
    throw new RuntimeError("invalid-input");
  if (c.model !== undefined && !validChoice(c.model)) throw new RuntimeError("invalid-input");
  if (c.agent !== undefined && !validAgentId(c.agent)) throw new RuntimeError("invalid-input");
  if (
    c.attachments !== undefined &&
    (!Array.isArray(c.attachments) ||
      c.attachments.length > ATTACHMENTS_PER_MESSAGE ||
      !c.attachments.every(validAttachmentName) ||
      new Set(c.attachments).size !== c.attachments.length)
  )
    throw new RuntimeError("invalid-input");
  if (c.type === "configure" && keys.length === 1) throw new RuntimeError("invalid-input");
  for (const key of keys.filter((key) => key !== "model" && key !== "agent" && key !== "attachments"))
    if (typeof c[key] !== "string" || !(c[key] as string).trim()) throw new RuntimeError("invalid-input");
  if ("sessionId" in c && !UUID.test(String(c.sessionId))) throw new RuntimeError("invalid-input");
  if (c.type === "create" && typeof c.folder === "string" && c.folder.length > 4096) throw new RuntimeError("invalid-input");
  if (c.type === "rename" && (String(c.title).length > 4096 || !sessionTitle(String(c.title)))) throw new RuntimeError("invalid-input");
  if ("text" in c && Buffer.byteLength(String(c.text)) > 64 * 1024) throw new RuntimeError("invalid-input");
  // SAFETY: discriminant, exact keys and every required field validated above.
  return c as unknown as Command;
}

/** An answer to an extension question: a string, a yes/no, or null to dismiss. */
function validAnswer(c: Record<string, unknown>): Command {
  if (
    Object.keys(c).length !== 5 ||
    !["commandId", "type", "sessionId", "dialogId", "value"].every((key) => key in c) ||
    !UUID.test(String(c.sessionId)) ||
    !UUID.test(String(c.dialogId)) ||
    !(c.value === null || typeof c.value === "boolean" || (typeof c.value === "string" && Buffer.byteLength(c.value) <= 64 * 1024))
  )
    throw new RuntimeError("invalid-input");
  // SAFETY: exact keys and every field validated above.
  return c as unknown as Command;
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

  constructor(private readonly runtime: SessionRuntime) {}

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
    receipt.state = "settled";
    receipt.outcome = "failed";
    receipt.error = failure(error);
    return;
  }
  Object.assign(receipt, await run.completion);
}
