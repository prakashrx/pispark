import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { body, logFailure, sendJson, statusOf } from "./io.js";
import { correlated } from "../core/logger.js";
import { Type, type Static, type TProperties } from "typebox";
import { ITEM_TYPES, type DiscoveredTool, type AgentTarget, type ItemTarget, type ResourceReference } from "../contract/agent-protocol.js";
import type { AgentStore } from "../core/agents/store.js";
import { AgentError, parseResource } from "../core/agents/format.js";
import { checkCycles, listAgents, viewAgent } from "../core/agents/resolve.js";
import { RuntimeError } from "../core/runtime/errors.js";
import { exact, shaped, type Same } from "./shape.js";

const MAXIMUM = 512 * 1024;
const target = Type.Union([exact({ agent: Type.String() }), exact({ session: Type.String() })]);
true satisfies Same<Static<typeof target>, AgentTarget>;
/** A layer, or `{library: "shared" | "bundled"}` for a file that lives in a library. */
const itemTarget = Type.Union([...target.anyOf, exact({ library: Type.Enum(["shared", "bundled"]) })]);
true satisfies Same<Static<typeof itemTarget>, ItemTarget>;
const type = Type.Enum(ITEM_TYPES);
const revision = Type.String({ pattern: "^[a-f0-9]{64}$" });
/** The revision a change was made against; empty for a layer that has none yet. */
const expectedRevision = Type.Union([revision, Type.Literal("")]);
const name = Type.String();
const path = Type.String();

/** What each operation takes: exactly these keys, each of its kind. What the values mean is the store's to check. */
const operation = <P extends TProperties>(properties: P) => shaped(exact(properties), () => new AgentError("invalid-input"));
const OPERATIONS = {
  read: operation({ target }),
  resources: operation({ target, type }),
  "resource/select": operation({ target, type, reference: Type.String(), on: Type.Boolean(), expectedRevision }),
  "resource/copy": operation({ target, type, name, from: itemTarget, expectedRevision }),
  "resource/promote": operation({ target, type, name, expectedRevision: revision }),
  create: operation({ name, description: Type.Optional(Type.String()), base: Type.Optional(Type.Array(Type.String())) }),
  save: operation({ target, expectedRevision, definition: Type.Unknown() }),
  delete: operation({ id: Type.String() }),
  "file/read": operation({ target: itemTarget, path }),
  "file/write": operation({ target: itemTarget, path, expectedRevision: Type.Union([revision, Type.Null()]), text: Type.String() }),
  "file/delete": operation({ target, path, expectedRevision: revision }),
};

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
  ) {}
  async handle(request: IncomingMessage, response: ServerResponse) {
    const requestId = randomUUID(),
      started = Date.now();
    await correlated({ requestId }, async () => {
      const url = new URL(request.url!, "http://localhost");
      const path = url.pathname;
      try {
        let result: unknown;
        if (request.method === "GET" && path === "/api/agents" && !url.search) result = { agents: listAgents(this.store) };
        else {
          if (request.method !== "POST" || url.search) throw new AgentError("not-found", 404);
          const value = await body(request, MAXIMUM);
          switch (path.slice("/api/agents/".length)) {
            case "read": {
              const viewed = OPERATIONS.read(value).target;
              // Listing an agent's tools loads its extensions; a failure leaves the list as switched.
              const discovered = await this.tools?.(viewed).catch(() => undefined);
              result = viewAgent(this.store, viewed, discovered);
              break;
            }
            case "resources": {
              const i = OPERATIONS.resources(value);
              result = { resources: this.store.available(i.target, i.type) };
              break;
            }
            case "resource/select": {
              const i = OPERATIONS["resource/select"](value);
              if (!parseResource(i.reference)) throw new AgentError("invalid-input");
              result = this.store.select(i.target, i.type, i.reference as ResourceReference, i.on, i.expectedRevision);
              break;
            }
            case "resource/copy": {
              const i = OPERATIONS["resource/copy"](value);
              result = this.store.copyIn(i.target, i.type, i.name, i.from, i.expectedRevision);
              break;
            }
            case "resource/promote": {
              const i = OPERATIONS["resource/promote"](value);
              result = this.store.promote(i.target, i.type, i.name, i.expectedRevision);
              break;
            }
            case "create":
              result = this.store.create(OPERATIONS.create(value));
              break;
            case "save": {
              const i = OPERATIONS.save(value);
              result = this.store.save(i.target, i.expectedRevision, i.definition, (definition) =>
                checkCycles(this.store, i.target, definition),
              );
              break;
            }
            case "delete":
              this.store.remove(OPERATIONS.delete(value).id);
              result = {};
              break;
            case "file/read": {
              const i = OPERATIONS["file/read"](value);
              result = this.store.readFile(i.target, i.path);
              break;
            }
            case "file/write": {
              const i = OPERATIONS["file/write"](value);
              result = this.store.writeFile(i.target, i.path, i.expectedRevision, i.text);
              break;
            }
            case "file/delete": {
              const i = OPERATIONS["file/delete"](value);
              this.store.deleteFile(i.target, i.path, i.expectedRevision);
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
        const status = error instanceof AgentError ? error.status : error instanceof RuntimeError ? statusOf(error) : 500;
        logFailure(this.store.logger, request, error, { status, code, durationMs: Date.now() - started });
        sendJson(
          response,
          status,
          {
            error: code,
            requestId,
            ...(error instanceof AgentError && error.detail ? { detail: error.detail } : {}),
          },
          MAXIMUM,
        );
      }
    });
  }
}
