import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { body, sendJson } from "./session-http.js";
import { correlated } from "./logger.js";
import type { PersonaRef } from "./persona-protocol.js";
import type { PersonaStore } from "./personas/store.js";
import { definition, object, PersonaError, ref } from "./personas/schema.js";
import { publicView, resolvePersona } from "./personas/resolver.js";
import { RuntimeError } from "./runtime/errors.js";
const MAXIMUM = 512 * 1024;
export class PersonaHttp {
  constructor(readonly store: PersonaStore) {}
  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID(),
      started = Date.now();
    await correlated({ requestId }, async () => {
      const url = new URL(request.url!, "http://localhost");
      const path = url.pathname;
      try {
        let result: unknown;
        if (
          request.method === "GET" &&
          path === "/api/personas" &&
          [...url.searchParams.keys()].every((k) => k === "cursor") &&
          url.searchParams.getAll("cursor").length <= 1
        ) {
          const cursor = url.searchParams.get("cursor") ?? "0";
          if (!/^\d{1,3}$/.test(cursor) || Number(cursor) > 256)
            throw new PersonaError("invalid-input", 400);
          const offset = Number(cursor),
            items = this.store.list(offset, 65);
          result = {
            personas: items.slice(0, 64),
            ...(items.length > 64 ? { nextCursor: String(offset + 64) } : {}),
          };
        } else {
          if (request.method !== "POST" || url.search)
            throw new PersonaError("not-found", 404);
          const allowed: Record<string, string[]> = {
            read: ["ref"],
            validate: ["ref", "definition"],
            create: ["definition"],
            save: ["ref", "expectedRevision", "definition"],
            instruction: ["ref", "path", "expectedRevision", "text"],
            "instruction/read": ["ref", "path"],
          };
          const operation = path.slice("/api/personas/".length);
          if (!Object.hasOwn(allowed, operation))
            throw new PersonaError("not-found", 404);
          const keys = allowed[operation]!;
          const input = object(
            await body(request, MAXIMUM),
            keys,
            operation === "validate" ? ["definition"] : keys,
          );
          const reference =
            input.ref === undefined
              ? undefined
              : (ref(input.ref) as PersonaRef);
          if (operation === "create")
            result = await this.store.create(input.definition);
          else if (operation === "validate") {
            const value = definition(input.definition);
            const target = reference ?? {
              root: "managed",
              path: value.id,
              id: value.id,
            };
            result = publicView(
              resolvePersona(
                this.store,
                target,
                value,
                true,
                reference
                  ? undefined
                  : join(this.store.roots.managed!, value.id),
              ),
            );
          } else if (operation === "read") {
            const stored = this.store.read(reference!);
            try {
              result = publicView(resolvePersona(this.store, reference!));
            } catch (error) {
              if (!(error instanceof PersonaError)) throw error;
              result = {
                ref: reference,
                definition: stored.definition,
                writable: stored.writable,
                definitionRevision: stored.definitionRevision,
                diagnostics: error.diagnostics,
                instructions: [],
                skills: [],
                excluded: [],
              };
            }
          } else if (operation === "save") {
            if (
              typeof input.expectedRevision !== "string" ||
              !/^[a-f0-9]{64}$/.test(input.expectedRevision)
            )
              throw new PersonaError("invalid-input", 400);
            result = await this.store.save(
              reference!,
              input.expectedRevision,
              input.definition,
            );
          } else {
            if (typeof input.path !== "string")
              throw new PersonaError("invalid-input", 400);
            if (operation === "instruction/read")
              result = this.store.instruction(reference!, input.path);
            else {
              if (
                typeof input.text !== "string" ||
                (input.expectedRevision !== null &&
                  (typeof input.expectedRevision !== "string" ||
                    !/^[a-f0-9]{64}$/.test(input.expectedRevision)))
              )
                throw new PersonaError("invalid-input", 400);
              result = await this.store.saveInstruction(
                reference!,
                input.path,
                input.expectedRevision as string | null,
                input.text,
              );
            }
          }
          this.store.logger.event(
            operation === "read" || operation === "instruction/read"
              ? "persona.read"
              : operation === "validate"
                ? "persona.validate"
                : "persona.save",
            {
              personaId: reference?.id,
              durationMs: Date.now() - started,
              outcome: "completed",
            },
          );
        }
        // Encode before headers: response overflow must return a truthful bounded failure.
        sendJson(response, 200, result, MAXIMUM);
      } catch (error) {
        const code =
          error instanceof PersonaError || error instanceof RuntimeError
            ? error.code
            : "storage";
        const status =
          error instanceof PersonaError
            ? [
                "invalid-definition",
                "limit",
                "unsupported-version",
                "path-outside-root",
              ].includes(error.code)
              ? 400
              : error.status
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
            ...(error instanceof PersonaError
              ? { diagnostics: error.diagnostics }
              : {}),
          },
          MAXIMUM,
        );
      }
    });
  }
}
