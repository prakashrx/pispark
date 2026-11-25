import type { RemoteAction, RemoteStatus } from "../../../../server/src/contract/remote-protocol";
import { RequestFailed, type Transport } from "../workspace/transport";

/**
 * Remote access as the server reports it (`/api/remote`): Tailscale, the address, pairing and the
 * paired devices. Only the computer running PiSpark may read or change it; a paired device is told so.
 */
export class RemoteClient {
  status = $state<RemoteStatus>();
  /** Asked from a paired device: remote access is managed on the computer itself. */
  elsewhere = $state(false);
  constructor(private readonly transport: Transport) {}

  async refresh(): Promise<void> {
    try {
      this.status = await this.transport.json<RemoteStatus>("/api/remote");
      this.elsewhere = false;
    } catch (error) {
      if (error instanceof RequestFailed && error.code === "forbidden") this.elsewhere = true;
      else throw error;
    }
  }

  async act(action: RemoteAction): Promise<void> {
    this.status = await this.transport.json<RemoteStatus>("/api/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
  }
}
