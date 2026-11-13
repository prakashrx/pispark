import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const events = [
  "host.start",
  "host.stop",
  "http.reject",
  "http.failure",
  "persona.save",
  "session.create",
  "session.recover",
  "session.start",
  "session.settle",
  "session.cancel",
  "session.failure",
  "schedule.add",
  "schedule.run",
  "schedule.failure",
  "schedule.unreadable",
] as const;
export type LogEvent = (typeof events)[number];
const codes = [
  "invalid-input",
  "invalid-path",
  "invalid-definition",
  "forbidden",
  "limit",
  "storage",
  "execution",
  "configuration",
  "credentials",
  "resources",
  "folder",
  "persona",
  "revision-conflict",
  "missing-parent",
  "cycle",
  "in-use",
  "built-in",
  "not-found",
  "closed",
  "owned",
  "sdk-version",
  "unsupported",
  "extension",
  "busy",
  "shutdown",
  "timeout",
  "cancelled",
] as const;
interface Correlation {
  requestId?: string;
  operationId?: string;
  sessionId?: string;
  personaId?: string;
}
interface Fields extends Correlation {
  durationMs?: number;
  outcome?: "completed" | "failed" | "cancelled" | "rejected";
  code?: string;
  counts?: {
    instructions?: number;
    skills?: number;
    definitions?: number;
    dropped?: number;
  };
}
const ids = new AsyncLocalStorage<Correlation>();
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function correlated<T>(context: Correlation, operation: () => T): T {
  return ids.run({ ...ids.getStore(), ...context }, operation);
}
export const requestId = () => randomUUID();

/** One serialized, bounded file writer; no error objects or domain content enter this boundary. */
export class SafeLogger {
  private queue: string[] = [];
  private bytes = 0;
  private writing = false;
  private closing = false;
  private retryAfter = 0;
  private warnedAt = -Infinity;
  private fallbackWriting = false;
  private dropped = 0;
  private readonly clock: () => number;
  constructor(
    private readonly options: {
      directory?: string;
      sink?: (line: string) => Promise<void>;
      clock?: () => number;
      fallback?: () => void;
      maxFileBytes?: number;
    } = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  event(
    event: LogEvent,
    fields: Fields = {},
    level: "info" | "error" | "debug" = "info",
  ): void {
    // Runtime projection also rejects unexpected keys supplied by untyped callers.
    if (!events.includes(event) || !["info", "error", "debug"].includes(level))
      return;
    if (this.closing || this.clock() < this.retryAfter) {
      this.drop();
      return;
    }
    const record: Record<string, unknown> = {
      timestamp: new Date(this.clock()).toISOString(),
      level,
      event,
    };
    const context = { ...ids.getStore(), ...fields };
    for (const key of ["requestId", "operationId", "sessionId"] as const)
      if (typeof context[key] === "string" && uuid.test(context[key]))
        record[key] = context[key];
    // Persona IDs are short slugs ("dev") chosen at creation.
    if (
      typeof context.personaId === "string" &&
      /^[a-z0-9][a-z0-9-]{0,47}$/.test(context.personaId)
    )
      record.personaId = context.personaId;
    if (Number.isFinite(fields.durationMs) && fields.durationMs! >= 0)
      record.durationMs = Math.min(Math.round(fields.durationMs!), 86_400_000);
    if (
      ["completed", "failed", "cancelled", "rejected"].includes(
        fields.outcome ?? "",
      )
    )
      record.outcome = fields.outcome;
    if (codes.includes(fields.code as (typeof codes)[number]))
      record.code = fields.code;
    const counts: Record<string, number> = {};
    for (const key of [
      "instructions",
      "skills",
      "definitions",
      "dropped",
    ] as const) {
      const value = fields.counts?.[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        counts[key] = Math.min(Math.floor(value), 1_000_000_000);
    }
    if (this.dropped) counts.dropped = this.dropped;
    if (Object.keys(counts).length) record.counts = counts;
    const line = JSON.stringify(record) + "\n";
    if (
      Buffer.byteLength(line) > 2048 ||
      this.queue.length >= 256 ||
      this.bytes + Buffer.byteLength(line) > 256 * 1024
    ) {
      this.drop();
      return;
    }
    this.queue.push(line);
    this.dropped = 0;
    this.bytes += Buffer.byteLength(line);
    void this.flush();
  }
  private drop() {
    this.dropped = Math.min(this.dropped + 1, 1_000_000_000);
  }
  private async file(line: string): Promise<void> {
    if (!this.options.directory) {
      await new Promise<void>((resolve, reject) => {
        // Writable emits 'error' after its callback too; rejecting alone would still crash on EPIPE.
        const failed = (error: Error) => reject(error);
        process.stdout.once("error", failed);
        try {
          process.stdout.write(line, (error) => {
            if (error) {
              setImmediate(() => {
                process.stdout.off("error", failed);
                reject(error);
              });
            } else {
              process.stdout.off("error", failed);
              resolve();
            }
          });
        } catch (error) {
          process.stdout.off("error", failed);
          reject(error);
        }
      });
      return;
    }
    const directory = this.options.directory;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "host.jsonl");
    const size = await stat(path).then(
      (s) => s.size,
      (e) => {
        if (e.code === "ENOENT") return 0;
        throw e;
      },
    );
    if (
      size + Buffer.byteLength(line) >
      (this.options.maxFileBytes ?? 5 * 1024 * 1024)
    ) {
      await rm(path + ".3", { force: true });
      for (let i = 2; i >= 0; i--) {
        await rename(i ? path + `.${i}` : path, path + `.${i + 1}`).catch(
          (e) => {
            if (e.code !== "ENOENT") throw e;
          },
        );
      }
    }
    const handle = await open(path, "a", 0o600);
    try {
      await handle.writeFile(line);
    } finally {
      await handle.close();
    }
  }
  private warn(message: string): void {
    if (this.fallbackWriting || process.stderr.destroyed) return;
    this.fallbackWriting = true;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      process.stderr.off("error", done);
      this.fallbackWriting = false;
    };
    process.stderr.once("error", done);
    try {
      process.stderr.write(message, (error) =>
        error ? setImmediate(done) : done(),
      );
    } catch {
      done();
    }
  }
  private async flush(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      while (this.queue.length) {
        const line = this.queue.shift()!;
        this.bytes -= Buffer.byteLength(line);
        await (this.options.sink ? this.options.sink(line) : this.file(line));
      }
    } catch {
      this.dropped = Math.min(
        this.dropped + this.queue.length + 1,
        1_000_000_000,
      );
      this.queue = [];
      this.bytes = 0;
      this.retryAfter = this.clock() + 60_000;
      if (this.clock() - this.warnedAt >= 60_000) {
        this.warnedAt = this.clock();
        try {
          (
            this.options.fallback ??
            (() => {
              this.warn("PiSpark logging sink unavailable; records dropped.\n");
            })
          )();
        } catch {
          /* logging is never fatal */
        }
      }
    } finally {
      this.writing = false;
    }
  }
  get pending() {
    return {
      records: this.queue.length,
      bytes: this.bytes,
      dropped: this.dropped,
      writing: this.writing,
    };
  }
  async close(timeoutMs = 2000): Promise<void> {
    this.closing = true;
    const until = Date.now() + timeoutMs;
    while ((this.writing || this.queue.length) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 5));
    this.dropped = Math.min(this.dropped + this.queue.length, 1_000_000_000);
    this.queue = [];
    this.bytes = 0;
    if (this.dropped)
      this.warn(`PiSpark logger shutdown: dropped ${this.dropped} records.\n`);
  }
}
export const silentLogger = new SafeLogger({ sink: async () => {} });
