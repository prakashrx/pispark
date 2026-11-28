import type { IncomingMessage, ServerResponse } from "node:http";
import { body, sendJson } from "./io.js";
import { validPairRequest, validRemoteAction, type RemoteDevice, type RemoteSelf } from "../contract/remote-protocol.js";
import type { RemoteAccess } from "../core/remote/remote-access.js";
import { RuntimeError } from "../core/runtime/errors.js";

/** Who a request that passed the guard comes from: this computer, or a device at the remote address. */
export type Admission = { local: true } | { local: false; device?: RemoteDevice };

/** The paired device's cookie lasts as long as browsers allow (400 days), and is renewed whenever the app opens. */
const COOKIE_AGE = 400 * 24 * 60 * 60;

/**
 * `/api/remote`: remote access settings and pairing (this computer only); `/api/remote/me`: what
 * the asking browser is; `/api/remote/pair`: a device at the remote address pairs with a code.
 * Invoked only inside SessionHttp's guard.
 */
export class RemoteHttp {
  constructor(
    readonly access: RemoteAccess,
    /** Ends the open streams of one device, or of every remote device. */
    private readonly ended: (device?: string) => void = () => {},
  ) {}

  /** The Host header PiSpark accepts besides its loopback addresses, while remote access is on. */
  get host(): string | undefined {
    return this.access.devices.host;
  }

  /** Each install has its own cookie: cookies are shared across ports of one host. */
  private cookie(request: IncomingMessage) {
    return `__Host-pispark-${request.socket.localPort}`;
  }

  private token(request: IncomingMessage): string | undefined {
    const name = `${this.cookie(request)}=`;
    const token = (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name))
      ?.slice(name.length);
    return token && /^[\w-]{43}$/.test(token) ? token : undefined;
  }

  /** The paired device a request at the remote address comes from, if any. */
  device(request: IncomingMessage): RemoteDevice | undefined {
    return this.access.devices.device(this.token(request));
  }

  private setCookie(request: IncomingMessage, response: ServerResponse, token: string) {
    response.setHeader("Set-Cookie", `${this.cookie(request)}=${token}; Path=/; Max-Age=${COOKIE_AGE}; HttpOnly; Secure; SameSite=Strict`);
  }

  /** This server's own loopback address, which Tailscale proxies to. */
  private target(request: IncomingMessage) {
    const local = request.socket.localAddress ?? "127.0.0.1";
    return `http://${local.includes(":") && !local.startsWith("::ffff:") ? `[${local}]` : "127.0.0.1"}:${request.socket.localPort}`;
  }

  async handle(request: IncomingMessage, response: ServerResponse, path: string, who: Admission) {
    if (path === "/api/remote/me" && request.method === "GET") {
      const self: RemoteSelf = who.local ? { remote: false } : { remote: true, ...(who.device ? { device: who.device } : {}) };
      // Opening the app renews a paired device's cookie, so a device in use never has to pair again.
      const token = !who.local && who.device ? this.token(request) : undefined;
      if (token) this.setCookie(request, response, token);
      return sendJson(response, 200, self);
    }
    if (path === "/api/remote/pair" && request.method === "POST") {
      if (who.local) return sendJson(response, 400, { error: "invalid-input" });
      const pair = validPairRequest(await body(request, 4096));
      if (!pair) return sendJson(response, 400, { error: "invalid-input" });
      try {
        const { device, token } = this.access.devices.pair(pair.code, pair.name);
        this.setCookie(request, response, token);
        return sendJson(response, 201, { device });
      } catch (error) {
        const code = error instanceof RuntimeError ? error.code : "execution";
        // A wrong code and no code at all answer alike.
        return sendJson(response, code === "limit" ? 409 : 403, { error: code === "limit" ? "limit" : "invalid-code" });
      }
    }
    // Everything else is the computer's own settings: never from a device, paired or not.
    if (!who.local) return sendJson(response, 403, { error: "forbidden" });
    if (path !== "/api/remote") return sendJson(response, 404, { error: "not-found" });
    const port = request.socket.localPort!;
    if (request.method === "GET") return sendJson(response, 200, await this.access.status(port, this.target(request)));
    if (request.method !== "POST") return sendJson(response, 405, { error: "invalid-input" });
    const action = validRemoteAction(await body(request, 4096));
    if (!action) return sendJson(response, 400, { error: "invalid-input" });
    switch (action.action) {
      case "on":
        await this.access.turnOn(port, this.target(request));
        break;
      case "off":
        await this.access.turnOff(port);
        this.ended();
        break;
      case "pair":
        this.access.startPairing();
        break;
      case "cancel-pairing":
        this.access.devices.cancelPairing();
        break;
      case "remove":
        this.access.devices.remove(action.device);
        this.ended(action.device);
        break;
    }
    sendJson(response, 200, await this.access.status(port, this.target(request)));
  }
}
