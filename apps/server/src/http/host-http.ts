import type { IncomingMessage, ServerResponse } from "node:http";
import { body, sendJson } from "./session-http.js";
import { validHostAction, type HostStatus } from "../contract/host-protocol.js";
import type { HostLink } from "../core/host-link.js";
import type { RunningWork } from "../contract/host-protocol.js";

/**
 * `GET /api/host`: this PiSpark's version, where it runs and its updates; `POST /api/host`: check,
 * update, cancel or change update choices (passed to the launcher). Invoked only inside SessionHttp's
 * local Host/Origin/Fetch-Metadata guard.
 */
export class HostHttp {
  constructor(
    private readonly link: HostLink,
    private readonly data: string,
    private readonly running: () => RunningWork,
  ) {}
  status(request: IncomingMessage): HostStatus {
    const launcher = this.link.launcher();
    const { version, ...rest } = launcher ?? { version: "development" };
    return {
      managed: this.link.managed,
      version,
      address: `http://${request.headers.host}`,
      data: this.data,
      ...(launcher ? { launcher: rest as HostStatus["launcher"] } : {}),
      running: this.running(),
    };
  }
  async handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method === "GET") return sendJson(response, 200, this.status(request), 256 * 1024);
    if (request.method !== "POST") return sendJson(response, 405, { error: "invalid-input" });
    const action = validHostAction(await body(request, 4096));
    if (!action) return sendJson(response, 400, { error: "invalid-input" });
    if (!this.link.managed) return sendJson(response, 409, { error: "not-managed" });
    this.link.act(action);
    sendJson(response, 202, {});
  }
}
