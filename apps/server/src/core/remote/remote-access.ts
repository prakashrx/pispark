import type { RemoteStatus } from "../../contract/remote-protocol.js";
import { RuntimeError } from "../runtime/errors.js";
import { RemoteDevices } from "./devices.js";
import { Tailscale, type TailscaleCli } from "./tailscale.js";

/**
 * The HTTPS port Tailscale serves a PiSpark on: 443 for the usual port 3000 (a plain address), the
 * PiSpark's own port for any other install, so installs side by side never share an address.
 */
const httpsPortFor = (port: number) => (port === 3000 ? 443 : port);
export const addressFor = (dnsName: string, port: number) => {
  const https = httpsPortFor(port);
  return `https://${dnsName}${https === 443 ? "" : `:${https}`}`;
};

/**
 * Remote access: turning Tailscale Serve on and off for this PiSpark, pairing codes, and the paired
 * devices. PiSpark accepts the remote address only while it is on; turning it off forgets the
 * address before Tailscale stops serving, so nothing more is let in from that moment.
 */
export class RemoteAccess {
  readonly devices: RemoteDevices;
  private enableUrl?: string;
  private error?: string;
  private changing = false;
  constructor(
    file: string,
    private readonly cli: TailscaleCli = new Tailscale(),
    now?: () => number,
  ) {
    this.devices = new RemoteDevices(file, now);
  }

  /** `target`: where Tailscale proxies to, this server's own loopback address. */
  async status(port: number, target: string): Promise<RemoteStatus> {
    const info = await this.cli.info();
    const address = info.dnsName ? addressFor(info.dnsName, port) : undefined;
    const on = !!info.dnsName && this.devices.address === address && (await this.cli.serving(info.dnsName, httpsPortFor(port), target));
    const pairing = on ? this.devices.currentPairing() : undefined;
    return {
      tailscale: info.state,
      ...(address ? { address } : {}),
      on,
      ...(this.enableUrl && !on ? { enableUrl: this.enableUrl } : {}),
      ...(this.error ? { error: this.error } : {}),
      devices: this.devices.list(),
      ...(pairing ? { pairing: { ...pairing, url: `${address}/pair#${pairing.code}` } } : {}),
    };
  }

  async turnOn(port: number, target: string): Promise<void> {
    await this.change(async () => {
      const info = await this.cli.info();
      if (info.state.state !== "ready" || !info.dnsName) throw new RuntimeError("unsupported");
      const result = await this.cli.serve(httpsPortFor(port), target);
      this.enableUrl = !result.ok && "enableUrl" in result ? result.enableUrl : undefined;
      this.error = !result.ok && "error" in result ? result.error : undefined;
      if (result.ok) this.devices.setAddress(addressFor(info.dnsName, port));
    });
  }

  async turnOff(port: number): Promise<void> {
    await this.change(async () => {
      this.devices.setAddress(undefined);
      this.devices.cancelPairing();
      this.enableUrl = undefined;
      try {
        await this.cli.stop(httpsPortFor(port));
        this.error = undefined;
      } catch (error) {
        // PiSpark already refuses the address; say that Tailscale may still be serving it.
        this.error = `PiSpark no longer accepts the address, but Tailscale didn’t stop serving it: ${(error as Error).message}`;
      }
    });
  }

  /** A pairing code; only while on, since the code is used at the remote address. */
  startPairing() {
    if (!this.devices.address) throw new RuntimeError("unsupported");
    return this.devices.startPairing();
  }

  private async change(work: () => Promise<void>) {
    if (this.changing) throw new RuntimeError("busy");
    this.changing = true;
    try {
      await work();
    } finally {
      this.changing = false;
    }
  }
}
