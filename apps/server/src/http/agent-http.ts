import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { body, sendJson } from "./session-http.js";
import { correlated } from "../core/logger.js";
import type { DiscoveredTool, AgentTarget, ItemTarget, ItemType, ResourceReference } from "../contract/agent-protocol.js";
import type { AgentStore } from "../core/agents/store.js";
import { AgentError, ITEM_TYPES, parseResource } from "../core/agents/format.js";
import { checkCycles, listAgents, viewAgent } from "../core/agents/resolve.js";
import { RuntimeError } from "../core/runtime/errors.js";

const MAXIMUM = 512 * 1024;
const REVISION = /^[a-f0-9]{64}$/;
function itemType(value: unknown): ItemType {
  if (!ITEM_TYPES.includes(value as ItemType)) throw new AgentError("invalid-input");
  return value as ItemType;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Exactly the keys an operation takes; anything else is refused. */
function input(value: unknown, keys: string[], optional: string[] = []) {
  if (!plain(value)) throw new AgentError("invalid-input");
  for (const key of Object.keys(value))
    if (!keys.includes(key) && !optional.includes(key))
      throw new AgentError("invalid-input");
  for (const key of keys)
    if (!(key in value)) throw new AgentError("invalid-input");
  return value;
}
function target(value: unknown): AgentTarget {
  if (!plain(value) || Object.keys(value).length !== 1)
    throw new AgentError("invalid-input");
  if (typeof value.agent === "string") return { agent: value.agent };
  if (typeof value.session === "string") return { session: value.session };
  throw new AgentError("invalid-input");
}
/** A layer, or `{library: "shared" | "bundled"}` for a file that lives in a library. */
function itemTarget(value: unknown): ItemTarget {
  if (plain(value) && Object.keys(value).length === 1 && (value.library === "shared" || value.library === "bundled"))
    return { library: value.library };
  return target(value);
}
function revision(value: unknown, allowEmpty = false): string {
  if (typeof value !== "string" || !(REVISION.test(value) || (allowEmpty && !value)))
    throw new AgentError("invalid-input");
  return value;
}

/**
 * GET /api/agents, then POST /api/agents/{read,create,save,delete,resources,resource/select,
 * resource/promote,file/read,file/write,file/delete}. A target is `{ agent: id }` or
 * `{ session: id }` (a session's own layer); file/read and file/write also take
 * `{ library: "shared" | "bundled" }`.
 */
export class AgentHttp {
  constructor(
    readonly store: AgentStore,
    /** The tools an agent's extensions register, found without a session. */
    private readonly tools?: (target: AgentTarget) => Promise<{ tools: DiscoveredTool[]; incomplete: boolean } | undefined>,
    /** The sessions side: an agent's Agent Builder session, and what goes when an agent does. */
    private readonly sessions?: {
      builder: (agent: string, fresh: boolean) => Promise<string>;
      release: (session: string) => void;
      agentRemoved: (agent: string) => Promise<void>;
    },
  ) {}
  async handle(request: IncomingMessage, response: ServerResponse) {
    const requestId = randomUUID(),
      started = Date.now();
    await correlated({ requestId }, async () => {
      const url = new URL(request.url!, "http://localhost");
      const path = url.pathname;
      try {
        let result: unknown;
        if (request.method === "GET" && path === "/api/agents" && !url.search)
          result = { agents: listAgents(this.store) };
        else {
          if (request.method !== "POST" || url.search)
            throw new AgentError("not-found", 404);
          const operation = path.slice("/api/agents/".length);
          const value = await body(request, MAXIMUM);
          switch (operation) {
            case "read": {
              const i = input(value, ["target"]);
              const viewed = target(i.target);
              // Listing an agent's tools loads its extensions; a failure leaves the list as switched.
              const discovered = await this.tools?.(viewed).catch(() => undefined);
              result = viewAgent(this.store, viewed, discovered);
              break;
            }
            case "resources": {
              const i = input(value, ["target", "type"]);
              result = { resources: this.store.available(target(i.target), itemType(i.type)) };
              break;
            }
            case "resource/select": {
              const i = input(value, ["target", "type", "reference", "on", "expectedRevision"]);
              if (typeof i.on !== "boolean" || !parseResource(i.reference)) throw new AgentError("invalid-input");
              result = this.store.select(target(i.target), itemType(i.type), i.reference as ResourceReference, i.on, revision(i.expectedRevision, true));
              break;
            }
            case "resource/promote": {
              const i = input(value, ["target", "type", "name", "expectedRevision"]);
              if (typeof i.name !== "string") throw new AgentError("invalid-input");
              result = this.store.promote(target(i.target), itemType(i.type), i.name, revision(i.expectedRevision));
              break;
            }
            case "create": {
              const i = input(value, ["name"], ["description", "base"]);
              if (typeof i.name !== "string") throw new AgentError("invalid-input");
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
              if (typeof i.id !== "string") throw new AgentError("invalid-input");
              this.store.remove(i.id);
              await this.sessions?.agentRemoved(i.id);
              result = {};
              break;
            }
            case "builder": {
              const i = input(value, ["agent"], ["fresh"]);
              if (typeof i.agent !== "string" || (i.fresh !== undefined && typeof i.fresh !== "boolean") || !this.sessions)
                throw new AgentError("invalid-input");
              result = { session: await this.sessions.builder(i.agent, i.fresh === true) };
              break;
            }
            case "builder/release": {
              const i = input(value, ["session"]);
              if (typeof i.session !== "string" || !this.sessions) throw new AgentError("invalid-input");
              this.sessions.release(i.session);
              result = {};
              break;
            }
            case "file/read": {
              const i = input(value, ["target", "path"]);
              result = this.store.readFile(itemTarget(i.target), i.path as string);
              break;
            }
            case "file/write": {
              const i = input(value, ["target", "path", "expectedRevision", "text"]);
              result = this.store.writeFile(
                itemTarget(i.target),
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
              throw new AgentError("not-found", 404);
          }
        }
        // Encode before headers: an oversized response fails truthfully.
        sendJson(response, 200, result, MAXIMUM);
      } catch (error) {
        const known = error instanceof AgentError || error instanceof RuntimeError;
        const code = known ? error.code : "storage";
        const status =
          error instanceof AgentError
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
            ...(error instanceof AgentError && error.detail
              ? { detail: error.detail }
              : {}),
          },
          MAXIMUM,
        );
      }
    });
  }
}
