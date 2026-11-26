import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { RuntimeError } from "../core/runtime/errors.js";
import { ASSET_TYPES } from "../core/extensions/view-compiler.js";

/** How every HTTP module reads a request and answers: bounded JSON, inert files. */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
      if (size > maximum) throw new RuntimeError("limit");
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
