<script lang="ts">
  import { tick } from "svelte";
  import SettingsPage from "../../lib/ui/SettingsPage.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Qr from "./Qr.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { copyText } from "../../lib/clipboard";
  import type { RemoteAction, RemoteDevice } from "../../../../server/src/contract/remote-protocol";
  /** Settings → Remote access: serve this PiSpark to your own devices through Tailscale, and pair them. */
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

<SettingsPage
  title="Remote access"
  description="Use PiSpark from your phone or another computer through Tailscale. Nothing is open to the internet: only your Tailscale devices can reach it, and each one pairs once."
  label="Remote access"
>
  {#if remote.elsewhere}
    <Section title="Managed on the computer" description="">
      <div class="notice mt-4" role="status">
        <Icon name="laptop" class="w-4 h-4 shrink-0" /><span class="flex-1 min-w-0"
          >Remote access and paired devices are managed in PiSpark on the computer it runs on, not from a paired device.</span
        >
      </div>
    </Section>
  {:else if !status || !tailscale}
    {#if error}
      <div class="notice mt-2" role="alert">
        <Icon name="alert" class="w-4 h-4 shrink-0" /><span class="flex-1">{error}</span>
        <Button size="compact" variant="ghost" onclick={() => void load()}>Try again</Button>
      </div>
    {:else}<p class="text-sm text-muted-foreground" role="status">Checking Tailscale…</p>{/if}
  {:else if tailscale.state === "missing"}
    <Section title="Set up Tailscale" description="">
      <div class="notice block mt-4" role="status">
        <p class="flex items-center gap-2"><Icon name="alert" class="w-4 h-4 shrink-0" /><strong>Tailscale isn’t installed on this computer</strong></p>
        <ol class="steps">
          <li>
            Install Tailscale on this computer and on your phone: <a class="link" href="https://tailscale.com/download" target="_blank" rel="noreferrer"
              >tailscale.com/download</a
            >
          </li>
          <li>Sign both in to the same account.</li>
        </ol>
        <div class="mt-3"><Button size="compact" onclick={() => void load()}>Check again</Button></div>
      </div>
    </Section>
  {:else if tailscale.state === "stopped"}
    <Section title="Set up Tailscale" description="">
      <div class="notice block mt-4" role="status">
        <p class="flex items-center gap-2"><Icon name="alert" class="w-4 h-4 shrink-0" /><strong>Tailscale isn’t running or signed in</strong></p>
        <p class="mt-1">Open Tailscale on this computer and sign in, then check again.</p>
        <div class="mt-3"><Button size="compact" onclick={() => void load()}>Check again</Button></div>
      </div>
    </Section>
  {:else}
    <Section title="Address" description="">
      <div class="mt-4 space-y-3">
        {#if status.on && status.address}
          <div class="notice" role="status">
            <span class="dot" aria-hidden="true"></span>
            <span class="grow-line"><strong>On</strong> · <span class="mono">{status.address}</span></span>
            <Button size="compact" variant="ghost" onclick={() => void copy(status.address!)}><Icon name="copy" class="w-4 h-4" />Copy</Button>
            <Button size="compact" variant="ghost" loading={acting === "off"} disabled={!!acting} onclick={() => void act({ action: "off" })}
              >Turn off</Button
            >
          </div>
          <p class="sr-only" role="status">{copied}</p>
          {#if copied}<p class="text-[0.8125rem] text-muted-foreground" aria-hidden="true">{copied}</p>{/if}
        {:else if status.enableUrl}
          <div class="notice block" role="alert">
            <p class="flex items-center gap-2"><Icon name="alert" class="w-4 h-4 shrink-0" /><strong>Your tailnet doesn’t allow Serve yet</strong></p>
            <p class="mt-1">
              Tailscale needs Serve (and HTTPS certificates) switched on once for your tailnet. It opens in your Tailscale admin; come back here when
              it’s done.
            </p>
            <div class="flex flex-wrap gap-2 mt-3">
              <a class="ui-button" data-variant="primary" data-size="compact" href={status.enableUrl} target="_blank" rel="noreferrer"
                >Open Tailscale admin</a
              >
              <Button size="compact" variant="ghost" loading={acting === "on"} disabled={!!acting} onclick={() => void act({ action: "on" })}
                >Try again</Button
              >
            </div>
          </div>
        {:else if status.address}
          <div class="notice" role="status">
            <Icon name="power" class="w-4 h-4 shrink-0" /><span class="flex-1">Off. PiSpark answers only on this computer.</span>
            <Button size="compact" variant="primary" loading={acting === "on"} disabled={!!acting} onclick={() => void act({ action: "on" })}
              >Turn on</Button
            >
          </div>
          <p class="text-[0.8125rem] text-muted-foreground">
            Turning on asks Tailscale to serve this PiSpark at <span class="mono">{status.address}</span>.
          </p>
        {:else}
          <div class="notice block" role="status">
            <p class="flex items-center gap-2"><Icon name="alert" class="w-4 h-4 shrink-0" /><strong>Tailscale has no name for this computer</strong></p>
            <p class="mt-1">Switch on MagicDNS in your Tailscale admin (DNS page), then check again.</p>
            <div class="mt-3"><Button size="compact" onclick={() => void load()}>Check again</Button></div>
          </div>
        {/if}
        {#if status.error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{status.error}</p>{/if}
        {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
        {#if !status.on}
          <div class="settings-card">
            <div class="row">
              <div class="min-w-0">
                <span class="text-sm font-medium text-foreground block">Tailscale</span>
                <span class="text-[0.8125rem] text-muted-foreground block mt-0.5"
                  >Signed in{tailscale.account ? ` as ${tailscale.account}` : ""} · this computer is {tailscale.machine}</span
                >
              </div>
            </div>
          </div>
        {/if}
      </div>
    </Section>
    {#if status.on || status.devices.length}
      <Section title="Devices" description="Each device pairs once. Removing one ends its access at once.">
        <div class="settings-card mt-4" id="devices-card" tabindex="-1" aria-label="Devices">
          <div class="row">
            <Icon name="laptop" class="w-5 h-5 text-muted-foreground shrink-0" />
            <div class="min-w-0 flex-1">
              <span class="text-sm font-medium text-foreground block">This computer</span>
              <span class="text-[0.8125rem] text-muted-foreground block mt-0.5">Always allowed · {location.origin}</span>
            </div>
          </div>
          {#each status.devices as device (device.id)}
            <div class="row">
              <Icon name="phone" class="w-5 h-5 text-muted-foreground shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="text-sm font-medium text-foreground block">{device.name}</span>
                <span class="text-[0.8125rem] text-muted-foreground block mt-0.5">{used(device)}</span>
              </div>
              <Button
                size="compact"
                variant="ghost"
                aria-label={`Remove ${device.name}`}
                disabled={!!acting}
                onclick={() => void actAndFocus({ action: "remove", device: device.id }, "devices-card")}>Remove</Button
              >
            </div>
          {/each}
          {#if status.on && status.pairing && status.address}
            <div class="pair" id="pairing" tabindex="-1" role="group" aria-labelledby="pair-title">
              <Qr text={status.pairing.url} label="Pairing link as a QR code" />
              <div class="grow-line">
                <p id="pair-title" class="text-sm font-medium">Scan this with the device’s camera</p>
                <ol class="steps">
                  <li>The device must be signed in to your Tailscale.</li>
                  <li>Scan the code; PiSpark opens on the device.</li>
                  <li>Name the device and press Pair.</li>
                </ol>
                <p class="text-[0.8125rem] text-muted-foreground mt-3">
                  Or open <span class="mono">{bare(status.address)}</span> on the device and enter
                </p>
                <p class="code mt-1" aria-label={`Code ${status.pairing.code.split("").join(" ")}`}>{spaced(status.pairing.code)}</p>
                <div class="flex flex-wrap items-center gap-3 mt-3">
                  <span class="text-[0.8125rem] text-muted-foreground">Works once · expires in {clock(left)}</span>
                  <Button size="compact" variant="ghost" disabled={!!acting} onclick={() => void actAndFocus({ action: "cancel-pairing" }, "pair-device")}>Cancel</Button>
                </div>
              </div>
            </div>
          {:else if status.on}
            <div class="px-5 py-3">
              <Button
                id="pair-device"
                size="compact"
                loading={acting === "pair"}
                disabled={!!acting}
                onclick={() => void actAndFocus({ action: "pair" }, "pairing")}>Pair a device</Button
              >
            </div>
          {/if}
        </div>
      </Section>
    {/if}
  {/if}
</SettingsPage>

<style>
  .notice {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-md);
    background: var(--muted);
    font-size: 0.875rem;
    color: var(--foreground);
  }
  .notice.block {
    display: block;
  }
  /* Takes the whole line when narrow, so what sits beside it wraps below instead of squeezing it. */
  .grow-line {
    flex: 1 1 16rem;
    min-width: 0;
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: var(--success-foreground);
    flex-shrink: 0;
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    overflow-wrap: anywhere;
  }
  .steps {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    list-style: decimal;
    font-size: 0.875rem;
    line-height: 1.7;
  }
  .steps li::marker {
    color: var(--muted-foreground);
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
  }
  .pair:focus,
  .settings-card:focus {
    outline: none;
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: flex-start;
    padding: 1.25rem;
  }
  .code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 1.375rem;
    letter-spacing: 0.2em;
    color: var(--foreground);
  }
</style>
