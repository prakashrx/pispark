<script lang="ts">
  import { onDestroy } from "svelte";
  import Modal from "../../../lib/ui/Modal.svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import AuthPrompt from "./AuthPrompt.svelte";
  import { AuthClient } from "../provider-client.svelte";
  import { providerErrorMessages } from "../../../../../server/src/provider-protocol";
  import { actionClass, type ProviderInfo } from "./types";
  let { provider, onclose, onchange }: { provider: ProviderInfo; onclose: () => void; onchange: () => void } = $props();
  const auth = new AuthClient(() => onchange());
  onDestroy(() => auth.dispose());
  // Defense in depth: links are display-only unless HTTPS without userinfo, even on an invalid host response.
  function href(value: string) { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }
</script>
<Modal label={`Connect ${provider.name}`} {onclose}>
  <div class="p-6 space-y-5">
    <div><h2 class="text-sm font-semibold">{provider.stored ? "Manage" : "Connect"} {provider.name}</h2><p class="mt-1 text-[11px] text-gray-500">{provider.stored ? "Sign-in saved" : provider.configured ? "Set up on this computer" : "Not set up"}</p></div>
    <p class="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">Pi supplies the sign-in steps. Credentials stay on the PiSpark host. Closing cancels this sign-in, not your chats.</p>
    {#if auth.error}<p class="text-xs text-gray-700" role="alert">{auth.error}</p>{/if}
    {#if auth.view && auth.view.state !== "pending"}
      <p role="status" class="text-xs text-gray-700">{auth.view.state === "saved" ? "Sign-in saved. Available models depend on your account." : auth.view.state === "saved-sync-failed" ? "Sign-in saved, but local synchronization failed. Reload status before continuing." : auth.view.state === "cancelled" ? "Sign-in cancelled or expired. Reload status before starting again." : providerErrorMessages["provider-failed"]}</p>
    {:else if auth.view}
      <div class="space-y-3 text-xs text-gray-600" aria-live="polite">
        {#each auth.view.events as event}
          {#if event.type === "auth_url"}<p>{event.instructions}</p><a class="underline break-all" href={href(event.url)} target="_blank" rel="noopener noreferrer">Open sign-in page: {event.url}</a>
          {:else if event.type === "device_code"}<p>Enter this code on the provider's device page.</p><p class="font-mono text-lg tracking-wider text-gray-900">{event.userCode}</p><a class="underline break-all" href={href(event.verificationUri)} target="_blank" rel="noopener noreferrer">{event.verificationUri}</a>{#if event.expiresInSeconds}<p>Provider expiry: {event.expiresInSeconds} seconds from issuance.</p>{/if}
          {:else}<p>{event.message}</p>{#each event.links ?? [] as link}<a class="block underline break-all" href={href(link.url)} target="_blank" rel="noopener noreferrer">{link.label ?? link.url}</a>{/each}{/if}
        {/each}
      </div>
      {#if auth.view.prompt}{#key auth.view.prompt.id}<AuthPrompt prompt={auth.view.prompt} busy={auth.busy} onrespond={(id, value) => auth.respond(id, value)} />{/key}{:else}<p class="text-xs text-gray-500" role="status">Waiting for Pi's sign-in flow…</p>{/if}
    {:else}
      <div class="space-y-2"><p class="text-xs font-medium">Choose a sign-in method</p>
        {#each provider.methods as method}<Button class={actionClass + " w-full text-left"} unavailable={auth.busy ? "Starting sign-in" : !method.interactive ? "Host setup only; Pi supplies no interactive login" : undefined} onclick={() => void auth.start(provider.id, method.type)}>{method.label}<span class="block text-[11px] text-gray-400 font-normal mt-1">{method.interactive ? method.type === "oauth" ? "Browser, device or code prompts supplied by Pi" : "Key or host configuration prompts supplied by Pi" : "Host setup only"}</span></Button>{/each}
      </div>
    {/if}
    <div class="pt-4 border-t border-gray-100"><Button class={actionClass} onclick={onclose}>{auth.view && auth.view.state !== "pending" ? "Close" : "Cancel"}</Button></div>
    <details class="border-t border-gray-200 pt-3 text-[11px] text-gray-500"><summary tabindex="0" class="cursor-pointer">Sign-in privacy &amp; limitations</summary><p class="mt-3">Only this dialog can observe or answer its prompts. Connection loss cancels after30 seconds; all flows expire after10 minutes. Some native methods require a host-local callback or browser. Use manual fallback when Pi offers it. Disconnecting removes stored credentials, not the provider grant or host configuration.</p></details>
  </div>
</Modal>
