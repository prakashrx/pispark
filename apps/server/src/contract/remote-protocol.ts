/**
 * Remote access: this PiSpark served to the owner's own devices through Tailscale Serve, and the
 * devices paired with it. The server keeps listening on loopback; Tailscale proxies to it. Managed
 * only from the computer running PiSpark.
 */

/** What PiSpark found of Tailscale on this computer. */
export type TailscaleState =
  /** The `tailscale` command isn't there. */
  | { state: "missing" }
  /** Installed, but not running or not signed in. */
  | { state: "stopped" }
  | { state: "ready"; account: string; machine: string };

export interface RemoteDevice {
  id: string;
  name: string;
  pairedAt: string;
  lastUsed?: string;
}

/** A code that pairs one device: works once, for a few minutes. */
export interface RemotePairing {
  code: string;
  expiresAt: string;
  /** What the QR code opens on the device. */
  url: string;
}

export interface RemoteStatus {
  tailscale: TailscaleState;
  /** Where Tailscale serves (or would serve) this PiSpark. */
  address?: string;
  /** PiSpark accepts its paired devices at the address, and Tailscale serves it there. */
  on: boolean;
  /** Tailscale refused because Serve isn't switched on for the tailnet: the admin page that switches it on. */
  enableUrl?: string;
  /** The last attempt to turn on or off failed: what Tailscale said. */
  error?: string;
  devices: RemoteDevice[];
  pairing?: RemotePairing;
}

export type RemoteAction =
  | { action: "on" }
  | { action: "off" }
  | { action: "pair" }
  | { action: "cancel-pairing" }
  | { action: "remove"; device: string };

/** What the browser asking is: this computer, or a device at the remote address (paired or not). */
export type RemoteSelf = { remote: false } | { remote: true; device?: RemoteDevice };

export const PAIRING_CODE = /^\d{6}$/;
export const DEVICE_NAME_MAX = 60;

export function validRemoteAction(value: unknown): RemoteAction | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  switch (v.action) {
    case "on":
    case "off":
    case "pair":
    case "cancel-pairing":
      return keys.length === 1 ? { action: v.action } : undefined;
    case "remove":
      return keys.length === 2 && typeof v.device === "string" && /^[\w-]{1,64}$/.test(v.device)
        ? { action: "remove", device: v.device }
        : undefined;
  }
}

/** A device's own name for itself: trimmed, printable, short. */
export function deviceName(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const name = value.trim().replace(/\s+/g, " ");
  return name && name.length <= DEVICE_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(name) ? name : undefined;
}

export function validPairRequest(value: unknown): { code: string; name: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const name = deviceName(v.name);
  if (Object.keys(v).length !== 2 || typeof v.code !== "string" || !PAIRING_CODE.test(v.code) || !name) return;
  return { code: v.code, name };
}
