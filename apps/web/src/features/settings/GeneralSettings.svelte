<script lang="ts">
  import Section from "../../lib/ui/Section.svelte";
  import FieldRow from "../../lib/ui/FieldRow.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Selector from "../../lib/ui/Selector.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { fontOptions, defaultPreferences, environment } from "./fixtures";
  import { personas } from "../workspace/fixtures";
  import { copyText } from "../../lib/clipboard";
  let notice = $state("");
  let font = $state(defaultPreferences.font);
  let persona = $state(defaultPreferences.persona);
  function reset() {
    font = defaultPreferences.font;
    persona = defaultPreferences.persona;
  }
</script>

<main
  id="workspace"
  aria-label="General settings local draft; environment values are fixtures"
  class="flex-1 overflow-y-auto px-8 py-8 bg-[#ffffff]"
>
  <div class="max-w-3xl mx-auto space-y-8 pb-20">
    <div class="border-b border-gray-100 pb-5" data-purpose="settings-header">
      <h1 class="text-xl font-semibold tracking-tight text-gray-900">
        General
      </h1>
      <p class="text-xs text-gray-500 mt-1">
        Make this workspace feel like yours and configure runtime execution
        preferences.
      </p>
    </div>
    <Section
      variant="settings"
      class="space-y-4"
      title="Appearance"
      description="Control visual chrome, contrast density, and typography scaling."
    >
      <div
        class="border border-gray-200/80 rounded-xl divide-y divide-gray-100 overflow-hidden bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
      >
        <FieldRow
          label="Theme"
          description="Choose a light or dark developer workspace surface."
        >
          <div
            class="inline-flex p-0.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600"
            role="group"
            aria-label="Theme"
          >
            <Button
              class="px-3 py-1 text-gray-500 hover:text-gray-900 rounded-md transition text-xs flex items-center space-x-1.5"
              type="button"
              unavailable="Only the supplied Light appearance is implemented"
            >
              <Icon name="system" class="w-3 h-3 text-gray-400" />
              <span>System</span>
            </Button>
            <Button
              class="px-3 py-1 bg-white text-gray-900 font-semibold rounded-md shadow-sm transition text-xs flex items-center space-x-1.5"
              type="button"
              aria-pressed="true"
            >
              <Icon name="sun" class="w-3 h-3 text-amber-500" />
              <span>Light</span>
            </Button>
            <Button
              class="px-3 py-1 text-gray-500 hover:text-gray-900 rounded-md transition text-xs flex items-center space-x-1.5"
              type="button"
              unavailable="Only the supplied Light appearance is implemented"
            >
              <Icon name="moon" class="w-3 h-3 text-gray-400" />
              <span>Dark</span>
            </Button>
          </div>
        </FieldRow>
        <FieldRow
          label="Workspace font family"
          description="Primary monospace typeface for terminal diffs and code tool widgets."
        >
          <div class="w-48">
            <Selector
              native
              label="Workspace font family"
              class="w-full text-xs border border-gray-200 rounded-lg py-1.5 px-2.5 bg-white text-gray-700 focus:outline-none focus:border-gray-400"
              bind:value={font}
              options={fontOptions}
            />
          </div>
        </FieldRow>
      </div>
    </Section>
    <Section
      variant="settings"
      class="space-y-4"
      title="Preferences"
      description="Default runtime persona instructions and confirmation guardrails."
    >
      <div
        class="border border-gray-200/80 rounded-xl divide-y divide-gray-100 overflow-hidden bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
      >
        <FieldRow
          label="Default persona"
          description="Initial prompt instructions, resources, and deliberate tool access."
        >
          <div class="w-48">
            <Selector
              native
              label="Default persona"
              class="w-full text-xs border border-gray-200 rounded-lg py-1.5 px-2.5 bg-white text-gray-800 font-medium focus:outline-none focus:border-gray-400"
              bind:value={persona}
              options={personas}
            />
          </div>
        </FieldRow>
      </div>
    </Section>
    <Section
      variant="settings"
      class="space-y-4"
      title="Environment &amp; Workspace"
      description="Host directory bindings, binaries, and execution status."
    >
      <div
        class="border border-gray-200/80 rounded-xl p-4 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-4"
      >
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-medium text-gray-900"
              >Current Root Directory</span
            >
            <span
              class="text-[11px] text-emerald-600 font-mono flex items-center gap-1"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Git Repository
            </span>
          </div>
          <div class="flex items-center space-x-2">
            <div
              class="flex-1 flex items-center border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 font-mono text-xs text-gray-700"
            >
              <Icon
                name="settingsFolder"
                class="w-3.5 h-3.5 text-gray-400 mr-2 flex-shrink-0"
              />
              <span class="truncate">{environment.root}</span>
            </div>
            <Button
              class="px-3 py-1.5 border border-gray-200 hover:bg-gray-50 rounded-lg text-xs text-gray-600 font-medium transition flex items-center space-x-1"
              type="button"
              onclick={async () => {
                notice = await copyText(environment.root);
              }}
            >
              <Icon name="copy" class="w-3.5 h-3.5 text-gray-500" />
              <span>Copy</span>
            </Button>
          </div>
        </div>
        <div
          class="pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2"
        >
          <span class="text-[11px] text-gray-400 mr-1">Detected runtime:</span>
          {#each environment.runtimes as runtime}
            <span
              class="inline-flex items-center text-[11px] font-mono text-gray-600 bg-gray-100/90 px-2 py-0.5 rounded-md border border-gray-200/50"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"
              ></span>
              {runtime}
            </span>
          {/each}
        </div>
      </div>
    </Section>
    <div
      class="pt-4 flex items-center justify-between border-t border-gray-100"
    >
      <Button
        class="text-xs text-gray-500 hover:text-gray-900 transition font-medium px-2 py-1"
        type="button"
        onclick={reset}
      >
        Reset to defaults
      </Button>
      <div class="flex items-center space-x-2">
        <span class="text-[11px] text-gray-400 italic mr-2"
          >Changes apply immediately</span
        >
        <Button
          class="px-4 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium transition shadow-sm"
          type="button"
          unavailable="Backend persistence is not connected; edits are local to this page"
        >
          Save changes
        </Button>
      </div>
    </div>
  </div>
  <p role="status" class="sr-only">{notice}</p>
</main>
