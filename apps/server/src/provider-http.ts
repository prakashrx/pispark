import type { IncomingMessage, ServerResponse } from "node:http";
import { body, sendJson } from "./session-http.js";
import { ProviderAuth } from "./runtime/provider-auth.js";
import type { ProviderSettings } from "./runtime/provider-settings.js";
import { ProviderError, providerFailure } from "./runtime/provider-errors.js";
import { deadline } from "./runtime/errors.js";
import { validChoice } from "./runtime/provider-storage.js";

function fields(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw new ProviderError("auth-invalid");
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 256, empty = false): string {
  if (typeof value !== "string" || (!empty && !value) || value.length > max)
    throw new ProviderError("auth-invalid");
  return value;
}
/** Invoked only inside SessionHttp's local Host/Origin/Fetch-Metadata and concurrency guard. */
export class ProviderHttp {
  readonly auth: ProviderAuth;
  constructor(readonly settings: ProviderSettings) {
    this.auth = new ProviderAuth(settings);
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url!, "http://localhost");
      if (url.search) throw new ProviderError("auth-invalid");
      if (request.method === "GET" && url.pathname === "/api/providers") {
        sendJson(response, 200, await this.settings.catalog(), 2 * 1024 * 1024);
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "not-found" });
        return;
      }
      const input = await body(request, 16 * 1024);
      switch (url.pathname) {
        case "/api/providers/default": {
          const c = fields(input, ["model"]);
          if (c.model !== null && !validChoice(c.model))
            throw new ProviderError("auth-invalid");
          await deadline(this.settings.setDefault(c.model), 15_000);
          break;
        }
        case "/api/providers/refresh":
        case "/api/providers/logout": {
          const c = fields(input, ["provider"]);
          const provider = string(c.provider, 128);
          if (url.pathname.endsWith("refresh"))
            await deadline(this.settings.refresh(provider), 15_000);
          else await deadline(this.settings.logout(provider), 15_000);
          break;
        }
        case "/api/providers/auth/start": {
          const c = fields(input, ["provider", "method"]);
          if (c.method !== "api_key" && c.method !== "oauth")
            throw new ProviderError("auth-invalid");
          sendJson(
            response,
            201,
            this.auth.start(string(c.provider, 128), c.method),
          );
          return;
        }
        case "/api/providers/auth/observe":
        case "/api/providers/auth/respond":
        case "/api/providers/auth/cancel": {
          const responding = url.pathname.endsWith("respond");
          const c = fields(
            input,
            responding ? ["id", "prompt", "value"] : ["id"],
          );
          // Capability never appears in URL/query or a session command receipt.
          const token =
            request.headers.authorization?.replace(/^Bearer /, "") ?? "";
          if (!/^[A-Za-z0-9_-]{43}$/.test(token))
            throw new ProviderError("auth-invalid");
          const id = string(c.id, 36);
          if (responding)
            this.auth.respond(
              id,
              token,
              string(c.prompt, 36),
              string(c.value, 8192, true),
            );
          else if (url.pathname.endsWith("cancel")) this.auth.cancel(id, token);
          else {
            sendJson(response, 200, this.auth.observe(id, token));
            return;
          }
          break;
        }
        default:
          sendJson(response, 404, { error: "not-found" });
          return;
      }
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { error: providerFailure(error) });
    }
  }
  async shutdown() {
    this.settings.stopAdmission();
    const results = await Promise.allSettled([
      this.auth.shutdown(),
      this.settings.close(),
    ]);
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
