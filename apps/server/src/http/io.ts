import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { SafeLogger } from "../core/logger.js";
import { RuntimeError } from "../core/runtime/errors.js";
import { ASSET_TYPES } from "../core/extensions/view-compiler.js";

/** How every HTTP module reads a request and answers: bounded JSON, inert files. */

const MAX_FRAME = 256 * 1024;

export function sendJson(response: ServerResponse, status: number, body: unknown, maximum = MAX_FRAME) {
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) > maximum) throw new RuntimeError("limit");
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(text);
}

/** The code a failure answers with: a runtime error's own, else `execution`. */
export function failure(error: unknown) {
  return error instanceof RuntimeError ? error.code : "execution";
}

/** A request body past its limit: the code is `limit` like any other, the status says the body was too large. */
class BodyTooLarge extends RuntimeError {
  constructor() {
    super("limit");
  }
}

const STATUS: Readonly<Record<string, number>> = {
  "not-found": 404,
  busy: 409,
  owned: 409,
  "read-only": 409,
  limit: 429,
  storage: 500,
  execution: 500,
  extension: 500,
  timeout: 500,
  "sdk-version": 500,
  // The server is shutting down.
  closed: 503,
};
/** The status a failure answers with: whose fault it was. Anything not listed is the request's own (400). */
export function statusOf(error: unknown): number {
  return error instanceof BodyTooLarge ? 413 : (STATUS[failure(error)] ?? 400);
}

/**
 * Records a request that failed: what was asked, how it was answered, and what kind of error it was.
 * A refused request (below 500) is not an error of the server's.
 */
export function logFailure(logger: SafeLogger, request: IncomingMessage, cause: unknown, fields: { status?: number; code?: string; durationMs?: number } = {}): void {
  const { status = statusOf(cause), code = failure(cause), durationMs } = fields;
  logger.event("http.failure", { outcome: "failed", code, status, durationMs, method: request.method, route: routeShape(request.url), cause }, status < 500 ? "info" : "error");
}

/** The fixed words of this API's paths. Anything else in a path is an id or a name, and is never logged. */
const ROUTE_WORDS = new Set(
  (
    "api agents assets attachments auth calls cancel catalog commands copy create default delete file files health host items live logout me " +
    "notes notifications observe output pair parts pending presence processes promote providers read receipts refresh remote remove resource " +
    "resources respond routines run save schedules select sessions settings start state stop subscribe test unsubscribe views write"
  ).split(" "),
);
/** A request's path with its ids and names taken out, for the log: `/api/sessions/:id/items`. */
export function routeShape(url = "/"): string {
  return url
    .split("?")[0]!
    .split("/")
    .slice(1, 13)
    .map((part) => `/${ROUTE_WORDS.has(part) ? part : ":id"}`)
    .join("");
}

/** A JSON body, bounded in size and time. */
export async function body(request: IncomingMessage, maximum = 72 * 1024): Promise<unknown> {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "") || request.headers["content-encoding"])
    throw new RuntimeError("invalid-input");
  let size = 0;
  const chunks: Buffer[] = [];
  const timer = setTimeout(() => request.destroy(), 5000);
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maximum) throw new BodyTooLarge();
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new RuntimeError("invalid-input");
    }
  } finally {
    clearTimeout(timer);
  }
}

/** What a file a session serves is served as; anything else is plain bytes. */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  ...ASSET_TYPES,
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};
/** Files reach the page as data: nothing in them may run or load, whatever they contain. */
export const INERT = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
};

/**
 * Streams `size` bytes of a file as it is now. A file that changes or goes away while it is read
 * ends the response; nothing else is affected.
 */
export async function streamFile(response: ServerResponse, file: string, size: number, headers: Record<string, string | number>) {
  response.writeHead(200, { ...headers, "Content-Length": size, ...INERT });
  if (!size) return void response.end();
  await pipeline(createReadStream(file, { end: size - 1 }), response).catch(() => response.destroy());
}
