import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Web Push without content (RFC 8030, VAPID RFC 8292). A push says only "look": the browser's push
 * service (Google, Apple, Mozilla) learns that something happened, never what. The service worker
 * then reads the notification text from PiSpark itself. With no payload there is nothing to encrypt,
 * so this needs no library: the VAPID token is an ES256 JWT signed with Node's crypto.
 */
export class PushKeys {
  readonly publicKey: string;
  private readonly privateKey: KeyObject;

  /** Keys from `file`, made (and kept, owner-only) the first time. */
  constructor(file: string) {
    let pem: string;
    try {
      pem = readFileSync(file, "utf8");
    } catch {
      pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(`${file}.tmp`, pem, { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    }
    this.privateKey = createPrivateKey(pem);
    const jwk = createPublicKey(this.privateKey).export({ format: "jwk" }) as { x: string; y: string };
    // The application server key a browser subscribes with: the uncompressed point, base64url.
    this.publicKey = base64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
  }

  /** The `Authorization` header for a push to `endpoint` (the token names only its origin). */
  authorization(endpoint: string, now = Date.now()): string {
    const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
    const claims = base64url(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: "https://github.com/prakashrx/pispark" }),
    );
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: this.privateKey, dsaEncoding: "ieee-p1363" });
    return `vapid t=${header}.${claims}.${base64url(signature)}, k=${this.publicKey}`;
  }

  /**
   * Sends one push with no content. `gone` when the subscription no longer exists (the person turned
   * notifications off in the browser, or the browser dropped it): forget it.
   */
  async send(endpoint: string, fetcher: typeof fetch = fetch): Promise<"sent" | "gone" | "failed"> {
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        // An empty body (Content-Length: 0); the header isn't set by hand, as some fetch implementations refuse that.
        headers: { Authorization: this.authorization(endpoint), TTL: "3600", Urgency: "high" },
        body: "",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404 || response.status === 410) return "gone";
      return response.ok ? "sent" : "failed";
    } catch {
      return "failed";
    }
  }
}

export function base64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

/** The browsers' push services: Chrome (Google), Firefox (Mozilla), Safari (Apple), Edge (Microsoft). */
const PUSH_SERVICES = [".googleapis.com", ".mozilla.com", ".push.apple.com", ".notify.windows.com"];

/**
 * A push service address: HTTPS on one of the browsers' push services, nothing else, so a device can't
 * make the server send requests anywhere it likes.
 */
export function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      PUSH_SERVICES.some((suffix) => url.hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}
