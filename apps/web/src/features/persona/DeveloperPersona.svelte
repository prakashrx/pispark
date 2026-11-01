<script lang="ts">
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import PromptList from "./PromptList.svelte";
  import ResourceList from "./ResourceList.svelte";
  import CommandList from "./CommandList.svelte";
  import { prompts, skills, extensions, commands } from "./fixtures";
  let name = $state("Developer");
  let localPrompts = $state(structuredClone(prompts));
  let localSkills = $state(structuredClone(skills));
  let localExtensions = $state(structuredClone(extensions));
  let localCommands = $state(structuredClone(commands));
</script>

<main
  id="workspace"
  class="flex-1 overflow-y-auto px-8 py-8 bg-[#ffffff]"
  aria-label="Developer persona local draft"
>
  <div class="max-w-4xl mx-auto space-y-8 pb-16">
    <div
      class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-gray-100 persona-heading"
    >
      <div class="space-y-1">
        <div class="flex items-center space-x-2 text-xs text-neutral-400">
          <span>Settings</span><span class="text-neutral-300">/</span><a
            class="hover:text-neutral-900 transition"
            href="#/persona">Personas</a
          ><span class="text-neutral-300">/</span><span
            class="font-mono text-neutral-700 bg-neutral-100 px-1.5 py-0.5 rounded"
            >developer</span
          >
          <span
            class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium ml-1"
            title="Fixture session association"
            ><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span><span
              >Active in session</span
            ></span
          >
        </div>
        <div class="flex items-center space-x-3 flex-wrap">
          <h1 class="text-2xl font-bold tracking-tight text-neutral-900">
            Developer Persona
          </h1>
          <span
            class="text-xs font-mono text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded"
            >v1.4.2</span
          ><span
            class="text-xs text-neutral-400 font-mono"
            title="Fixture filename; local edits are not persisted"
            >Saved as developer.json</span
          >
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <Button
          class="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-medium transition shadow-sm"
          unavailable="JSON drawer is not included in the supplied design"
          ><Symbol name="data_object" class="text-sm" /><span>Inspect JSON</span
          ></Button
        >
        <Button
          class="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg text-xs font-medium transition shadow-sm"
          unavailable="Backend persistence is not connected; edits are local to this page"
          ><Symbol name="save" class="text-sm" /><span>Save Persona</span
          ></Button
        >
      </div>
    </div>
    <div class="space-y-1.5">
      <label
        for="persona-name"
        class="block text-xs font-semibold text-neutral-700">Display Name</label
      ><Input
        id="persona-name"
        label="Display Name"
        class="w-full max-w-md text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 transition"
        bind:value={name}
      />
    </div>
    <PromptList bind:items={localPrompts} />
    <ResourceList
      title="Skills"
      description="Skills made available to this persona during sessions"
      singular="Skill"
      bind:items={localSkills}
    />
    <ResourceList
      title="Extensions"
      description="Tool extensions and runtime integrations"
      singular="Extension"
      bind:items={localExtensions}
    />
    <CommandList bind:items={localCommands} />
  </div>
</main>
