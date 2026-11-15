<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import { PAIRING_CODE, deviceName } from "../../../../server/src/contract/remote-protocol";
  /**
   * What a device at the remote address sees until it pairs: the code (filled in when it came from
   * the QR code) and a name for the device. Pairing sets the device's cookie and opens PiSpark.
   */
  const scanned = /^#(\d{6})$/.exec(location.hash)?.[1];
  let code = $state(scanned ?? "");
  let codeShown = $state(!scanned);
  let name = $state(guessName());
  let error = $state("");
  let pairing = $state(false);
  // The code stays out of the address bar and history once read.
  if (scanned) history.replaceState(null, "", location.pathname);

  function guessName() {
    const agent = navigator.userAgent;
    if (/iPhone/.test(agent)) return "iPhone";
    if (/iPad/.test(agent)) return "iPad";
    if (/Android/.test(agent)) return /Mobile/.test(agent) ? "Android phone" : "Android tablet";
    return /Mac/.test(agent) ? "Mac" : /Windows/.test(agent) ? "Windows computer" : "Computer";
  }
  const digits = $derived(code.replace(/\s/g, ""));
  async function pair(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    const clean = deviceName(name);
    if (!PAIRING_CODE.test(digits)) return void (error = "Enter the 6-digit code shown on your computer.");
    if (!clean) return void (error = "Give this device a name, up to 60 characters.");
    pairing = true;
    try {
      const response = await fetch("/api/remote/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: digits, name: clean }),
      });
      if (response.ok) {
        location.replace("/");
        return;
      }
      const { error: reason } = (await response.json().catch(() => ({}))) as { error?: string };
      codeShown = true;
      error =
        reason === "limit"
          ? "PiSpark has as many paired devices as it allows. Remove one on your computer first."
          : reason === "forbidden"
            ? "Remote access is off on your computer."
            : "That code didn’t work. It may have expired or been used: make a new one on your computer.";
    } catch {
      error = "Couldn’t reach PiSpark. Check this device is connected to your Tailscale.";
    } finally {
      pairing = false;
    }
  }
</script>

<svelte:head><title>PiSpark — Pair this device</title></svelte:head>
<main class="pair-page" aria-labelledby="pair-heading">
  <form class="card" onsubmit={pair} novalidate>
    <span class="logo" aria-hidden="true">π</span>
    <div>
      <h1 id="pair-heading">Pair this device</h1>
      <p class="text-sm text-muted-foreground mt-1">
        {#if codeShown}On your computer, open PiSpark → Settings → Remote access → Pair a device, then scan the code with this device’s camera, or
          type the code here.{:else}The code came with the QR code. Give this device a name so you can recognise it in PiSpark.{/if}
      </p>
    </div>
    {#if codeShown}
      <label class="field">
        <span>Code</span>
        <Input
          bind:value={code}
          monospace
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength={7}
          placeholder="6 digits"
          class="code"
          aria-describedby={error ? "pair-error" : undefined}
        />
      </label>
    {/if}
    <label class="field">
      <span>Device name</span>
      <Input bind:value={name} maxlength={60} autocomplete="off" />
    </label>
    {#if error}<p id="pair-error" role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
    <Button type="submit" variant="primary" class="big" loading={pairing}>Pair</Button>
    <p class="text-[0.8125rem] text-muted-foreground">
      Only devices on your Tailscale can open this page. Pairing lets this one use PiSpark until you remove it.
    </p>
  </form>
</main>

<style>
  .pair-page {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(2rem, env(safe-area-inset-top)) 1.5rem max(2rem, env(safe-area-inset-bottom));
    background: var(--background);
    color: var(--foreground);
  }
  .card {
    width: 100%;
    max-width: 22rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  /* The shell's brand mark, larger. */
  .logo {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 0.875rem;
    background: var(--brand-gradient);
    color: white;
    font-size: 1.375rem;
    font-weight: 700;
    line-height: 1;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }
  h1 {
    font-size: 1.375rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    font-size: 0.875rem;
  }
  .field :global(.code) {
    letter-spacing: 0.2em;
    font-size: 1.125rem;
  }
  .card :global(.big) {
    min-height: 2.75rem;
    width: 100%;
    justify-content: center;
  }
</style>
