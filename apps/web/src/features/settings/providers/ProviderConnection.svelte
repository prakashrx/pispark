<script lang="ts">
  import { onDestroy } from "svelte";
  import Button from "../../../lib/ui/Button.svelte";
  import AuthPrompt from "./AuthPrompt.svelte";
  import { AuthClient } from "../provider-client.svelte";
  import { providerErrorMessages } from "../../../../../server/src/provider-protocol";
  import type { ProviderInfo } from "./types";
  let {
    provider,
    onreset,
    onchange,
  }: { provider: ProviderInfo; onreset: () => void; onchange: () => void } =
    $props();
  const auth = new AuthClient(() => onchange());
  onDestroy(() => auth.dispose());
  // Defense in depth: links are display-only unless HTTPS without userinfo, even on an invalid host response.
  function href(value: string) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  }
</script>

<section class="space-y-4" aria-label={`Sign in to ${provider.name}`}>
  <div class="flex items-start justify-between gap-4">
    <div>
      <h4 class="text-sm font-semibold">Sign-in</h4>
      <p class="text-[0.8125rem] text-muted-foreground mt-0.5">
        Pi supplies the steps. Credentials stay on the PiSpark host.
      </p>
    </div>
    {#if auth.view || auth.error}<Button size="compact" onclick={onreset}
        >{auth.view && auth.view.state !== "pending"
          ? "Start over"
          : "Cancel sign-in"}</Button
      >{/if}
  </div>
  {#if auth.error}<p class="inline-note" data-tone="danger" role="alert">
      {auth.error}
    </p>{/if}
  {#if auth.view && auth.view.state !== "pending"}
    <p
      role="status"
      class="inline-note"
      data-tone={auth.view.state === "saved" ? "success" : "warning"}
    >
      {auth.view.state === "saved"
        ? "Sign-in saved. Available models depend on your account."
        : auth.view.state === "saved-sync-failed"
          ? "Sign-in saved, but local synchronization failed. Reload status before continuing."
          : auth.view.state === "cancelled"
            ? "Sign-in cancelled or expired. Reload status before starting again."
            : providerErrorMessages["provider-failed"]}
    </p>
  {:else if auth.view}
    <div class="space-y-3 text-sm text-muted-foreground" aria-live="polite">
      {#each auth.view.events as event}
        {#if event.type === "auth_url"}<p>{event.instructions}</p>
          <a
            class="settings-link break-all !whitespace-normal"
            href={href(event.url)}
            target="_blank"
            rel="noopener noreferrer">Open sign-in page ↗</a
          >
        {:else if event.type === "device_code"}<p>
            Enter this code on the provider's device page.
          </p>
          <p
            class="inline-block font-mono text-2xl tracking-[0.2em] text-foreground bg-[var(--muted)] rounded-xl px-4 py-2"
          >
            {event.userCode}
          </p>
          <a
            class="settings-link block break-all !whitespace-normal"
            href={href(event.verificationUri)}
            target="_blank"
            rel="noopener noreferrer">{event.verificationUri}</a
          >{#if event.expiresInSeconds}<p class="text-xs">
              Provider expiry: {event.expiresInSeconds} seconds from issuance.
            </p>{/if}
        {:else}<p>{event.message}</p>
          {#each event.links ?? [] as link}<a
              class="settings-link block break-all !whitespace-normal"
              href={href(link.url)}
              target="_blank"
              rel="noopener noreferrer">{link.label ?? link.url}</a
            >{/each}{/if}
      {/each}
    </div>
    {#if auth.view.prompt}{#key auth.view.prompt.id}<AuthPrompt
          prompt={auth.view.prompt}
          busy={auth.busy}
          onrespond={(id, value) => auth.respond(id, value)}
        />{/key}{:else}<p class="text-sm text-muted-foreground" role="status">
        Waiting for Pi's sign-in flow…
      </p>{/if}
  {:else}
    <div class="method-grid" role="group" aria-label="Choose a sign-in method">
      {#each provider.methods as method}<button
          type="button"
          class="method"
          aria-disabled={auth.busy || !method.interactive || undefined}
          title={auth.busy
            ? "Starting sign-in"
            : !method.interactive
              ? "Host setup only; Pi supplies no interactive login"
              : undefined}
          onclick={() => {
            if (!auth.busy && method.interactive)
              void auth.start(provider.id, method.type);
          }}
          ><span class="font-medium">{method.label}</span><span
            class="block text-xs text-muted-foreground mt-0.5"
            >{method.interactive
              ? method.type === "oauth"
                ? "Browser, device or code prompts"
                : "Paste a key or answer host prompts"
              : "Host setup only"}</span
          ></button
        >{:else}<p class="text-sm text-muted-foreground">
          No sign-in method supplied.
        </p>{/each}
    </div>
  {/if}
  <details class="text-xs text-muted-foreground">
    <summary class="cursor-pointer">Sign-in privacy &amp; limitations</summary>
    <p class="mt-2 leading-relaxed">
      Only this panel can observe or answer its prompts. Collapsing it cancels
      the sign-in, not your chats. Connection loss cancels after 30 seconds;
      all flows expire after 10 minutes. Some native methods require a
      host-local callback or browser. Disconnecting removes stored
      credentials, not the provider grant or host configuration.
    </p>
  </details>
</section>

<style>
  .method-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.625rem;
  }
  .method {
    text-align: left;
    padding: 0.75rem 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--background);
    font-size: 0.875rem;
    color: var(--foreground);
    transition: border-color 0.12s, background 0.12s;
  }
  .method:hover:not([aria-disabled="true"]) {
    border-color: var(--interactive);
    background: var(--interactive-muted);
  }
  .method[aria-disabled="true"] {
    opacity: 0.55;
  }
</style>
