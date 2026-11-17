<script lang="ts">
  import { tick } from "svelte";
  import Card from "../../lib/ui/Card.svelte";
  import CardRow from "../../lib/ui/CardRow.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Qr from "./Qr.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { copyText } from "../../lib/clipboard";
  import type { RemoteAction, RemoteDevice } from "../../../../server/src/contract/remote-protocol";
  /**
   * Settings → Remote access (set 6): serve this PiSpark to your own devices through Tailscale, and
   * pair them. Pairing opens inside the Devices card (QR, code, countdown, Cancel), not a dialog.
   */
  const remote = useSessions().remote;
  const status = $derived(remote.status);
  const tailscale = $derived(status?.tailscale);
  let error = $state("");
  let acting = $state<RemoteAction["action"]>();
  let copied = $state("");
  let now = $state(Date.now());

  $effect(() => {
    void load();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  // While a code is showing, look every two seconds for the device that uses it.
  $effect(() => {
    if (!status?.pairing) return;
    const timer = setInterval(() => void remote.refresh().catch(() => {}), 2000);
    return () => clearInterval(timer);
  });
  const left = $derived(status?.pairing ? Math.max(0, Date.parse(status.pairing.expiresAt) - now) : 0);
  $effect(() => {
    if (status?.pairing && left === 0) void remote.refresh().catch(() => {});
  });

  async function load() {
    error = "";
    try {
      await remote.refresh();
    } catch {
      error = "PiSpark couldn’t read remote access. Try again.";
    }
  }
  async function act(action: RemoteAction) {
    error = "";
    acting = action.action;
    try {
      await remote.act(action);
    } catch {
      error =
        action.action === "on" ? "Turning on didn’t finish. Check Tailscale is running, then try again." : "That didn’t work. Try again.";
    } finally {
      acting = undefined;
    }
  }
  /** Acts, then puts focus where the person goes next, since the control they used goes away. */
  async function actAndFocus(action: RemoteAction, target: string) {
    await act(action);
    await tick();
    document.getElementById(target)?.focus();
  }
  async function copy(text: string) {
    copied = await copyText(text);
    setTimeout(() => (copied = ""), 3000);
  }
  function when(at: string) {
    const date = new Date(at);
    const today = new Date(now).toDateString() === date.toDateString();
    return today ? `today at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : date.toLocaleDateString();
  }
  function ago(at: string) {
    const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : new Date(at).toLocaleDateString();
  }
  const used = (device: RemoteDevice) =>
    `Paired ${when(device.pairedAt)}${device.lastUsed ? ` · last used ${ago(device.lastUsed)}` : " · not used yet"}`;
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;
  const spaced = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;
  const bare = (address: string) => address.replace(/^https:\/\//, "");
</script>

{#snippet setup(title: string, text: string, steps?: boolean)}
  <CardRow>
    <div class="notice" role="status">
      <p class="flex items-center gap-2"><Icon name="alert" class="w-4 h-4 shrink-0" /><strong>{title}</strong></p>
      {#if steps}<ol class="steps">
          <li>
            Install Tailscale on this computer and on your phone: <a class="link" href="https://tailscale.com/download" target="_blank" rel="noreferrer"
              >tailscale.com/download</a
            >
          </li>
          <li>Sign both in to the same account.</li>
        </ol>{:else}<p class="mt-1">{text}</p>{/if}
      <div class="mt-3"><Button size="compact" onclick={() => void load()}>Check again</Button></div>
    </div>
  </CardRow>
{/snippet}

<Card title="Remote access">
  {#snippet action()}
    {#if status && tailscale?.state === "ready" && status.address && !remote.elsewhere}<Toggle
        label="Remote access"
        checked={status.on}
        disabled={!!acting}
        onchange={(event) => void act({ action: (event.currentTarget as HTMLInputElement).checked ? "on" : "off" })}
      />{/if}
  {/snippet}
  {#if remote.elsewhere}
    <CardRow>
      <p class="flex items-start gap-2 text-sm" role="status">
        <Icon name="laptop" class="mt-0.5 w-4 h-4 shrink-0" />Remote access and paired devices are managed in PiSpark on the computer it runs on, not from
        a paired device.
      </p>
    </CardRow>
  {:else if !status || !tailscale}
    <CardRow>
      {#if error}<p class="flex items-center gap-2 text-sm" role="alert">
          <Icon name="alert" class="w-4 h-4 shrink-0" /><span class="flex-1">{error}</span>
          <Button size="compact" variant="ghost" onclick={() => void load()}>Try again</Button>
        </p>{:else}<p class="text-sm text-muted-foreground" role="status">Checking Tailscale…</p>{/if}
    </CardRow>
  {:else if tailscale.state === "missing"}
    {@render setup("Tailscale isn’t installed on this computer", "", true)}
  {:else if tailscale.state === "stopped"}
    {@render setup("Tailscale isn’t running or signed in", "Open Tailscale on this computer and sign in, then check again.")}
  {:else if !status.address}
    {@render setup("Tailscale has no name for this computer", "Switch on MagicDNS in your Tailscale admin (DNS page), then check again.")}
  {:else}
    <CardRow label="Address">
      <span class="mono flex-1">{status.address}</span>
      <button type="button" class="icon" aria-label="Copy address" title="Copy" onclick={() => void copy(status.address!)}><Icon name="copy" class="w-4 h-4" /></button>
      <span class="sr-only" role="status">{copied}</span>
    </CardRow>
    <CardRow label="Tailscale">
      <span class="text-muted-foreground">Signed in{tailscale.account ? ` as ${tailscale.account}` : ""} · this computer is “{tailscale.machine}”</span>
    </CardRow>
    {#if status.enableUrl && !status.on}
      <CardRow>
        <div class="notice" role="alert">
          <p class="flex items-center gap-2"><Icon name="alert" class="w-4 h-4 shrink-0" /><strong>Your tailnet doesn’t allow Serve yet</strong></p>
          <p class="mt-1">
            Tailscale needs Serve (and HTTPS certificates) switched on once for your tailnet. It opens in your Tailscale admin; come back here when it’s
            done.
          </p>
          <div class="flex flex-wrap gap-2 mt-3">
            <a class="ui-button" data-variant="primary" data-size="compact" href={status.enableUrl} target="_blank" rel="noreferrer">Open Tailscale admin</a>
            <Button size="compact" variant="ghost" loading={acting === "on"} disabled={!!acting} onclick={() => void act({ action: "on" })}>Try again</Button>
          </div>
        </div>
      </CardRow>
    {:else if !status.on}
      <CardRow><p class="text-muted-foreground">Off. PiSpark answers only on this computer.</p></CardRow>
    {/if}
    {#if status.error || error}<CardRow>
        {#if status.error}<p role="alert" class="text-[var(--danger-foreground)]">{status.error}</p>{/if}
        {#if error}<p role="alert" class="text-[var(--danger-foreground)]">{error}</p>{/if}
      </CardRow>{/if}
  {/if}
</Card>

{#if status && !remote.elsewhere && tailscale?.state === "ready" && (status.on || status.devices.length)}
  <Card title="Devices" count={String(status.devices.length + 1)}>
    {#if status.on && status.pairing && status.address}
      <div class="pair" id="pairing" tabindex="-1" role="group" aria-labelledby="pair-title">
        <Qr text={status.pairing.url} label="Pairing link as a QR code" />
        <div class="grow-line">
          <p id="pair-title" class="text-sm font-medium">Scan with the device’s camera</p>
          <p class="text-xs text-muted-foreground mt-0.5">
            It must be signed in to your Tailscale. Or open <span class="mono">{bare(status.address)}</span> on the device and type the code.
          </p>
          <p class="code mt-2" aria-label={`Code ${status.pairing.code.split("").join(" ")}`}>{spaced(status.pairing.code)}</p>
          <p class="text-xs text-muted-foreground mt-1">Waiting for the device · works once · expires in {clock(left)}</p>
          <div class="mt-2">
            <Button size="compact" disabled={!!acting} onclick={() => void actAndFocus({ action: "cancel-pairing" }, "pair-device")}>Cancel</Button>
          </div>
        </div>
      </div>
    {/if}
    <div class="device" id="devices-card" tabindex="-1">
      <Icon name="laptop" class="w-4 h-4 text-muted-foreground shrink-0" />
      <span class="font-medium">This computer</span><span class="text-xs text-muted-foreground">always allowed</span>
    </div>
    {#each status.devices as device (device.id)}
      <div class="device">
        <Icon name="phone" class="w-4 h-4 text-muted-foreground shrink-0" />
        <span class="font-medium">{device.name}</span>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{used(device)}</span>
        <button
          type="button"
          class="icon"
          aria-label={`Remove ${device.name}`}
          title="Remove"
          disabled={!!acting}
          onclick={() => void actAndFocus({ action: "remove", device: device.id }, "devices-card")}><Icon name="close" class="w-4 h-4" /></button
        >
      </div>
    {/each}
    {#if status.on && !status.pairing}
      <CardRow>
        <Button id="pair-device" size="compact" loading={acting === "pair"} disabled={!!acting} onclick={() => void actAndFocus({ action: "pair" }, "pairing")}
          >Pair a device</Button
        >
      </CardRow>
    {/if}
  </Card>
{/if}

<style>
  .notice {
    padding: 0.25rem 0;
    font-size: var(--text-sm);
  }
  .grow-line {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
  .steps {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    list-style: decimal;
    line-height: 1.7;
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    color: var(--muted-foreground);
  }
  .icon:hover {
    background: var(--accent);
    color: var(--foreground);
  }
  .device {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0.375rem 0.75rem 0.375rem 1rem;
    font-size: var(--text-sm);
  }
  .device:focus,
  .pair:focus {
    outline: none;
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    padding: 1rem;
    background: var(--muted);
  }
  .code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 1.375rem;
    font-weight: 600;
    letter-spacing: 0.15em;
  }
</style>
