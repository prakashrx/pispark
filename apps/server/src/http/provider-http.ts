import type { IncomingMessage, ServerResponse } from "node:http";
import { Type, type TProperties } from "typebox";
import { body, logFailure, sendJson, statusOf } from "./io.js";
import { exact, shaped } from "./shape.js";
import { silentLogger, type SafeLogger } from "../core/logger.js";
import { ProviderAuth } from "../core/runtime/provider-auth.js";
import type { ProviderSettings } from "../core/runtime/provider-settings.js";
import { ProviderError, providerFailure } from "../core/runtime/provider-errors.js";
import { deadline } from "../core/runtime/errors.js";
import { validChoice } from "../core/runtime/provider-storage.js";

/** What each request takes: exactly these keys, each of its kind and length. */
const taking = <P extends TProperties>(properties: P) => shaped(exact(properties), () => new ProviderError("auth-invalid"));
const short = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const provider = short(128);
const id = short(36);
const BODIES = {
  default: taking({ model: Type.Unknown() }),
  provider: taking({ provider }),
  start: taking({ provider, method: Type.Enum(["api_key", "oauth"]) }),
  attempt: taking({ id }),
  respond: taking({ id, prompt: short(36), value: Type.String({ maxLength: 8192 }) }),
};
/** Invoked only inside SessionHttp's local Host/Origin/Fetch-Metadata and concurrency guard. */
export class ProviderHttp {
  readonly auth: ProviderAuth;
  constructor(
    readonly settings: ProviderSettings,
    private readonly logger: SafeLogger = silentLogger,
  ) {
    this.auth = new ProviderAuth(settings);
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url!, "http://localhost");
      // `?check`: try each saved sign-in too (Settings → Providers asks when it opens).
      if (request.method === "GET" && url.pathname === "/api/providers" && (!url.search || url.search === "?check")) {
        sendJson(response, 200, await this.settings.catalog({ check: url.search === "?check" }), 2 * 1024 * 1024);
        return;
      }
      if (url.search) throw new ProviderError("auth-invalid");
      if (request.method !== "POST") {
        sendJson(response, 404, { error: "not-found" });
        return;
      }
      const input = await body(request, 16 * 1024);
      switch (url.pathname) {
        case "/api/providers/default": {
          const { model } = BODIES.default(input);
          if (model !== null && !validChoice(model)) throw new ProviderError("auth-invalid");
          await deadline(this.settings.setDefault(model), 15_000);
          break;
        }
        case "/api/providers/refresh":
        case "/api/providers/logout": {
          const { provider } = BODIES.provider(input);
          if (url.pathname.endsWith("refresh")) await deadline(this.settings.refresh(provider), 15_000);
          else await deadline(this.settings.logout(provider), 15_000);
          break;
        }
        case "/api/providers/auth/start": {
          const { provider, method } = BODIES.start(input);
          sendJson(response, 201, this.auth.start(provider, method));
          return;
        }
        case "/api/providers/auth/observe":
        case "/api/providers/auth/respond":
        case "/api/providers/auth/cancel": {
          // Capability never appears in URL/query or a session command receipt.
          const token = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
          if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ProviderError("auth-invalid");
          if (url.pathname.endsWith("respond")) {
            const { id, prompt, value } = BODIES.respond(input);
            this.auth.respond(id, token, prompt, value);
          } else if (url.pathname.endsWith("cancel")) this.auth.cancel(BODIES.attempt(input).id, token);
          else {
            sendJson(response, 200, this.auth.observe(BODIES.attempt(input).id, token));
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
      // A provider's own refusal is the request's; anything else is logged like every other failure.
      const status = error instanceof ProviderError ? 400 : statusOf(error);
      if (!(error instanceof ProviderError)) logFailure(this.logger, request, error);
      sendJson(response, status, { error: providerFailure(error) });
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
