import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { body, sendJson } from "./session-http.js";
import { correlated } from "../core/logger.js";
import type { PersonaTarget } from "../contract/persona-protocol.js";
import type { PersonaStore } from "../core/personas/store.js";
import { PersonaError } from "../core/personas/format.js";
import { checkCycles, viewPersona } from "../core/personas/resolve.js";
import { RuntimeError } from "../core/runtime/errors.js";

const MAXIMUM = 512 * 1024;
const REVISION = /^[a-f0-9]{64}$/;

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Exactly the keys an operation takes; anything else is refused. */
function input(value: unknown, keys: string[], optional: string[] = []) {
  if (!plain(value)) throw new PersonaError("invalid-input");
  for (const key of Object.keys(value))
    if (!keys.includes(key) && !optional.includes(key))
      throw new PersonaError("invalid-input");
  for (const key of keys)
    if (!(key in value)) throw new PersonaError("invalid-input");
  return value;
}
function target(value: unknown): PersonaTarget {
  if (!plain(value) || Object.keys(value).length !== 1)
    throw new PersonaError("invalid-input");
  if (typeof value.persona === "string") return { persona: value.persona };
  if (typeof value.chat === "string") return { chat: value.chat };
  throw new PersonaError("invalid-input");
}
function revision(value: unknown, allowEmpty = false): string {
  if (typeof value !== "string" || !(REVISION.test(value) || (allowEmpty && !value)))
    throw new PersonaError("invalid-input");
  return value;
}

/**
 * GET /api/personas, then POST /api/personas/{read,create,save,delete,file/read,file/write,file/delete}.
 * A target is `{ persona: id }` or `{ chat: id }` (a chat's own layer).
 */
export class PersonaHttp {
  constructor(readonly store: PersonaStore) {}
  async handle(request: IncomingMessage, response: ServerResponse) {
    const requestId = randomUUID(),
      started = Date.now();
    await correlated({ requestId }, async () => {
      const url = new URL(request.url!, "http://localhost");
      const path = url.pathname;
      try {
        let result: unknown;
        if (request.method === "GET" && path === "/api/personas" && !url.search)
          result = { personas: this.store.list() };
        else {
          if (request.method !== "POST" || url.search)
            throw new PersonaError("not-found", 404);
          const operation = path.slice("/api/personas/".length);
          const value = await body(request, MAXIMUM);
          switch (operation) {
            case "read": {
              const i = input(value, ["target"]);
              result = viewPersona(this.store, target(i.target));
              break;
            }
            case "create": {
              const i = input(value, ["name"], ["description", "base"]);
              if (typeof i.name !== "string") throw new PersonaError("invalid-input");
              result = this.store.create({
                name: i.name,
                ...(typeof i.description === "string"
                  ? { description: i.description }
                  : {}),
                ...(Array.isArray(i.base) ? { base: i.base as string[] } : {}),
              });
              break;
            }
            case "save": {
              const i = input(value, ["target", "expectedRevision", "definition"]);
              const t = target(i.target);
              result = this.store.save(
                t,
                revision(i.expectedRevision, true),
                i.definition,
                (definition) => checkCycles(this.store, t, definition),
              );
              break;
            }
            case "delete": {
              const i = input(value, ["id"]);
              if (typeof i.id !== "string") throw new PersonaError("invalid-input");
              this.store.remove(i.id);
              result = {};
              break;
            }
            case "file/read": {
              const i = input(value, ["target", "path"]);
              result = this.store.readFile(target(i.target), i.path as string);
              break;
            }
            case "file/write": {
              const i = input(value, ["target", "path", "expectedRevision", "text"]);
              result = this.store.writeFile(
                target(i.target),
                i.path as string,
                i.expectedRevision === null ? null : revision(i.expectedRevision),
                i.text as string,
              );
              break;
            }
            case "file/delete": {
              const i = input(value, ["target", "path", "expectedRevision"]);
              this.store.deleteFile(
                target(i.target),
                i.path as string,
                revision(i.expectedRevision),
              );
              result = {};
              break;
            }
            default:
              throw new PersonaError("not-found", 404);
          }
        }
        // Encode before headers: an oversized response fails truthfully.
        sendJson(response, 200, result, MAXIMUM);
      } catch (error) {
        const known = error instanceof PersonaError || error instanceof RuntimeError;
        const code = known ? error.code : "storage";
        const status =
          error instanceof PersonaError
            ? error.status
            : error instanceof RuntimeError
              ? 400
              : 500;
        this.store.logger.event(
          "http.failure",
          { durationMs: Date.now() - started, outcome: "failed", code },
          "error",
        );
        sendJson(
          response,
          status,
          {
            error: code,
            requestId,
            ...(error instanceof PersonaError && error.detail
              ? { detail: error.detail }
              : {}),
          },
          MAXIMUM,
        );
      }
    });
  }
}
