import type { IncomingMessage, ServerResponse } from "node:http";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { ATTACHMENT_MAX_BYTES, validAttachmentName } from "../core/runtime/attachments.js";
import { RuntimeError } from "../core/runtime/errors.js";
import type { SessionRuntime } from "../core/runtime/session-runtime.js";
import { viewAsset, viewBundle } from "../core/extensions/view-compiler.js";
import { FILE_TYPES, INERT, sendJson, streamFile } from "./io.js";

const MAX_IMAGE = 20 * 1024 * 1024;
/** The largest file an extension component may read through `host.file`. */
const MAX_FILE = 64 * 1024 * 1024;
const typeOf = (name: string) => FILE_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";

/**
 * The bytes a session serves, all as inert data: what the person attached, the pictures and long
 * text in its history, the files an extension component reads, and the components themselves.
 */
export class SessionFiles {
  constructor(private readonly runtime: SessionRuntime) {}

  /**
   * A file a person attaches: the raw bytes as the body, the name in `X-File-Name` (URI-encoded). Stored
   * in the session's `files/` folder under a free name, which is returned.
   */
  async attach(id: string, request: IncomingMessage) {
    let name: string;
    try {
      name = decodeURIComponent(String(request.headers["x-file-name"] ?? ""));
    } catch {
      throw new RuntimeError("invalid-input");
    }
    if (request.headers["content-encoding"] || !validAttachmentName(name)) throw new RuntimeError("invalid-input");
    const length = Number(request.headers["content-length"] ?? NaN);
    if (Number.isFinite(length) && length > ATTACHMENT_MAX_BYTES) throw new RuntimeError("limit");
    const stored = await this.runtime.attach(id, name, request);
    return { ...stored, type: typeOf(stored.name) };
  }

  /** An attachment, served as inert data: nothing in it may run or load, whatever it contains. */
  async attachment(id: string, encoded: string, response: ServerResponse) {
    const found = await this.found(() => this.runtime.attachment(id, decodeURIComponent(encoded)), ["not-found", "invalid-input"]);
    if (!found) return sendJson(response, 404, { error: "not-found" });
    await streamFile(response, found.file, found.size, {
      "Content-Type": typeOf(found.file),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(basename(found.file))}`,
      "Cache-Control": "no-store",
    });
  }

  /**
   * An extension component's `host.file(path)`: a file in the folder its own placement named, as
   * it is now. Served as inert data.
   */
  async file(id: string, query: URLSearchParams, response: ServerResponse) {
    const { point, key, path } = Object.fromEntries(query);
    if (
      [...query.keys()].some((name) => !["point", "key", "path"].includes(name)) ||
      point === undefined ||
      key === undefined ||
      path === undefined
    )
      throw new RuntimeError("invalid-input");
    const found = await this.found(() => this.runtime.file(id, point, key, path), ["not-found"]);
    if (!found) return sendJson(response, 404, { error: "not-found" });
    if (found.size > MAX_FILE) throw new RuntimeError("limit");
    await streamFile(response, found.file, found.size, { "Content-Type": typeOf(found.file), "Cache-Control": "no-store" });
  }

  /** An image part's bytes, or a chunk of a clipped text part (`?offset=`). */
  part(id: string, itemId: string, part: number, query: URLSearchParams, response: ServerResponse) {
    const offset = query.get("offset");
    if ([...query.keys()].some((key) => key !== "offset") || (offset !== null && !/^\d{1,9}$/.test(offset)))
      throw new RuntimeError("invalid-input");
    if (offset !== null) return sendJson(response, 200, this.runtime.text(id, itemId, part, Number(offset)));
    const { mimeType, data } = this.runtime.image(id, itemId, part);
    if (data.length > MAX_IMAGE) throw new RuntimeError("limit");
    response.writeHead(200, {
      "Content-Type": mimeType,
      "Content-Length": data.length,
      "Cache-Control": "private, max-age=31536000, immutable",
      // An SVG is only ever drawn as an image; nothing in it may run or load.
      ...INERT,
    });
    response.end(data);
  }

  /** An extension component, compiled and addressed by its content. */
  component(hash: string, response: ServerResponse) {
    const code = viewBundle(hash);
    if (!code) return sendJson(response, 404, { error: "not-found" });
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": Buffer.byteLength(code),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(code);
  }

  /** A static file an extension component imported, addressed by its content. */
  async asset(name: string, response: ServerResponse) {
    const asset = await viewAsset(name);
    if (!asset) return sendJson(response, 404, { error: "not-found" });
    response.writeHead(200, {
      "Content-Type": asset.type,
      "Content-Length": asset.data.length,
      "Cache-Control": "private, max-age=31536000, immutable",
      ...INERT,
    });
    response.end(asset.data);
  }

  /** A file the runtime names, with its size; undefined when it is one of the `absent` codes or is gone. */
  private async found(locate: () => string, absent: string[]): Promise<{ file: string; size: number } | undefined> {
    try {
      const file = locate();
      return { file, size: (await stat(file)).size };
    } catch (error) {
      if (error instanceof RuntimeError && !absent.includes(error.code)) throw error;
      return undefined;
    }
  }
}
