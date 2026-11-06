<script lang="ts">
  import Section from "../../lib/ui/Section.svelte";
  import FieldRow from "../../lib/ui/FieldRow.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  const client = useSessions();
</script>

<main
  id="workspace"
  aria-label="General settings"
  class="flex-1 overflow-y-auto px-8 py-8 bg-[#ffffff]"
>
  <div class="max-w-3xl mx-auto space-y-8 pb-20">
    <div class="border-b border-gray-100 pb-5" data-purpose="settings-header">
      <h1 class="text-xl font-semibold tracking-tight text-gray-900">
        General
      </h1>
      <p class="text-xs text-gray-500 mt-1">Your workspace at a glance.</p>
    </div>
    <Section
      variant="settings"
      class="space-y-4"
      title="Appearance"
      description=""
    >
      <div
        class="border border-gray-200/80 rounded-xl divide-y divide-gray-100 overflow-hidden bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
      >
        <FieldRow label="Theme" description="Only the light theme is available."
          ><span class="text-xs text-gray-700">Light</span></FieldRow
        >
      </div>
    </Section>
    <Section
      variant="settings"
      class="space-y-4"
      title="Workspace"
      description=""
    >
      <div
        class="border border-gray-200/80 rounded-xl divide-y divide-gray-100 overflow-hidden bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
      >
        <FieldRow label="Working folders" description="">
          <div class="text-xs text-gray-700 space-y-1">
            {#if client.catalogLoading}<p role="status">
                Loading working folders…
              </p>
            {:else if client.catalogError}<p role="alert">
                Couldn’t load working folders. Try reconnecting.
              </p>
            {:else}{#each client.catalog.workspaces as workspace}<p>
                  {workspace.label}
                </p>{:else}<p>No working folders are configured.</p>{/each}{/if}
          </div>
        </FieldRow>
        <FieldRow
          label="Personas"
          description="Manage instructions and skills for your chats."
          ><a
            class="text-xs underline underline-offset-2"
            href="#/persona"
            onclick={() => client.personas.collection()}>Manage personas</a
          ></FieldRow
        >
        <FieldRow
          label="Providers &amp; models"
          description="Connect an account and choose a model."
          ><a class="text-xs underline underline-offset-2" href="#/providers"
            >Providers &amp; models</a
          ></FieldRow
        >
      </div>
    </Section>
  </div>
</main>
