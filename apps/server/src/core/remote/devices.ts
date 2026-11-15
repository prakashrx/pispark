import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "../agents/store.js";
import { RuntimeError } from "../runtime/errors.js";
import type { RemoteDevice, RemotePairing } from "../../contract/remote-protocol.js";

/** How long a pairing code works, and how many wrong tries end it. */
export const PAIRING_MS = 5 * 60_000;
const PAIRING_TRIES = 5;
const MAX_DEVICES = 32;
/** A device's last use is written at most this often. */
const LAST_USED_MS = 60_000;

interface StoredDevice extends RemoteDevice {
  /** SHA-256 of the device's token; the token itself is only ever in the device's cookie. */
  hash: string;
}
interface Stored {
  /** The remote address PiSpark accepts, while remote access is on. */
  address?: string;
  devices: StoredDevice[];
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Remote access's own state, in `<home>/remote.json`: the address PiSpark accepts and the devices
 * paired with it. The pairing code lives in memory only; restarting PiSpark ends it.
 */
export class RemoteDevices {
  private stored: Stored;
  private pairing?: { code: string; expires: number; tries: number };
  private written = new Map<string, number>();
  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.stored = read(file);
  }

  /** `https://<name>[:port]`, while on. */
  get address(): string | undefined {
    return this.stored.address;
  }
  /** The Host header requests at the address carry. */
  get host(): string | undefined {
    return this.stored.address ? new URL(this.stored.address).host : undefined;
  }
  setAddress(address: string | undefined) {
    this.stored = { ...this.stored, address };
    this.save();
  }

  list(): RemoteDevice[] {
    return this.stored.devices.map(({ hash: _, ...device }) => device);
  }

  /** The device a token belongs to, noting that it was used. */
  device(token: string | undefined): RemoteDevice | undefined {
    if (!token) return;
    const digest = hash(token);
    const device = this.stored.devices.find((d) => d.hash === digest);
    if (!device) return;
    const now = this.now();
    device.lastUsed = new Date(now).toISOString();
    if (now - (this.written.get(device.id) ?? 0) > LAST_USED_MS) {
      this.written.set(device.id, now);
      this.save();
    }
    const { hash: _, ...visible } = device;
    return visible;
  }

  /** A new pairing code, replacing any earlier one. */
  startPairing(): Omit<RemotePairing, "url"> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pairing = { code, expires: this.now() + PAIRING_MS, tries: 0 };
    return this.currentPairing()!;
  }
  cancelPairing() {
    this.pairing = undefined;
  }
  currentPairing(): Omit<RemotePairing, "url"> | undefined {
    if (this.pairing && this.pairing.expires <= this.now()) this.pairing = undefined;
    return this.pairing && { code: this.pairing.code, expiresAt: new Date(this.pairing.expires).toISOString() };
  }

  /** Pairs a device with the current code: its record and the token for its cookie. The code works once. */
  pair(code: string, name: string): { device: RemoteDevice; token: string } {
    const pairing = this.currentPairing() && this.pairing!;
    if (!pairing) throw new RuntimeError("not-found");
    if (pairing.code !== code) {
      // A few wrong tries end the code, so it can't be guessed.
      if (++pairing.tries >= PAIRING_TRIES) this.pairing = undefined;
      throw new RuntimeError("invalid-input");
    }
    if (this.stored.devices.length >= MAX_DEVICES) throw new RuntimeError("limit");
    this.pairing = undefined;
    const token = randomBytes(32).toString("base64url");
    const device: StoredDevice = { id: randomUUID(), name, pairedAt: new Date(this.now()).toISOString(), hash: hash(token) };
    this.stored = { ...this.stored, devices: [...this.stored.devices, device] };
    this.save();
    const { hash: _, ...visible } = device;
    return { device: visible, token };
  }

  remove(id: string) {
    if (!this.stored.devices.some((d) => d.id === id)) throw new RuntimeError("not-found");
    this.stored = { ...this.stored, devices: this.stored.devices.filter((d) => d.id !== id) };
    this.written.delete(id);
    this.save();
  }

  private save() {
    try {
      writeAtomic(this.file, JSON.stringify(this.stored, null, 2) + "\n");
    } catch {
      throw new RuntimeError("storage");
    }
  }
}

/** A missing or unreadable file is remote access off with no devices: nothing is let in by mistake. */
function read(file: string): Stored {
  if (!existsSync(file)) return { devices: [] };
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Stored>;
    const address = typeof value.address === "string" && /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i.test(value.address) ? value.address : undefined;
    const devices = Array.isArray(value.devices)
      ? value.devices.filter(
          (d): d is StoredDevice =>
            !!d &&
            typeof d.id === "string" &&
            typeof d.name === "string" &&
            typeof d.pairedAt === "string" &&
            typeof d.hash === "string" &&
            /^[a-f0-9]{64}$/.test(d.hash) &&
            (d.lastUsed === undefined || typeof d.lastUsed === "string"),
        )
      : [];
    return { ...(address ? { address } : {}), devices };
  } catch {
    return { devices: [] };
  }
}
