<script lang="ts">
  import Modal from "../../lib/ui/Modal.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Input from "../../lib/ui/Input.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Symbol from "../../lib/ui/Symbol.svelte";
  import type { SourceDraft } from "./fixtures";
  let {
    names,
    onclose,
    onadd,
  }: {
    names: string[];
    onclose: () => void;
    onadd: (draft: SourceDraft) => void;
  } = $props();
  let kind = $state<"git" | "registry">("git");
  let name = $state("");
  let location = $state("");
  let branch = $state("");
  let autoUpdate = $state(true);
  let error = $state("");
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || !location.trim()) {
      error = "Enter a source name and URL or path.";
      return;
    }
    if (
      names.some((value) => value.toLowerCase() === name.trim().toLowerCase())
    ) {
      error = "Source name already exists in this local draft.";
      return;
    }
    onadd({
      name: name.trim(),
      location: location.trim(),
      branch: branch.trim(),
      kind,
      autoUpdate,
    });
  }
</script>

<Modal label="Add New Source" {onclose}>
  <div class="px-6 py-4 bg-gray-50/60 flex items-center justify-between">
    <div>
      <h2 class="text-sm font-semibold text-gray-900 tracking-tight">
        Add New Source
      </h2>
      <p class="text-[11px] text-gray-500 mt-0.5">
        Supply prompts, tools, and extensions from git or registry
      </p>
    </div>
    <Button
      class="text-gray-400 hover:text-gray-600 p-1 rounded-md transition"
      aria-label="Close Add Source"
      onclick={onclose}><Symbol name="close" class="text-[18px]" /></Button
    >
  </div>
  <form class="p-6 space-y-5" onsubmit={submit} aria-label="Local source draft">
    <div>
      <span
        class="block text-xs font-medium text-gray-700 mb-1.5"
        id="source-type-label">Source Type</span
      >
      <div
        class="grid grid-cols-2 gap-2"
        role="group"
        aria-labelledby="source-type-label"
      >
        {#each ["git", "registry"] as type}<Button
            class={"flex items-center justify-center gap-2 p-2.5 rounded-lg text-xs font-medium transition " +
              (kind === type
                ? "bg-neutral-900 text-white shadow-sm"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200")}
            aria-pressed={kind === type}
            onclick={() => {
              kind = type as "git" | "registry";
            }}
            ><Symbol
              name={type === "git" ? "terminal" : "storefront"}
              class="text-[16px]"
            /><span
              >{type === "git" ? "Git Repository" : "Marketplace URL"}</span
            ></Button
          >{/each}
      </div>
    </div>
    <div>
      <label
        class="block text-xs font-medium text-gray-700 mb-1"
        for="source-name">Source Name</label
      ><Input
        id="source-name"
        label="Source Name"
        class="source-input"
        bind:value={name}
        placeholder="e.g. org-developer-tools"
        required
      />
      <p class="text-[10px] text-gray-400 mt-1">
        Unique identifier used for namespacing skills.
      </p>
    </div>
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="block text-xs font-medium text-gray-700" for="source-url"
          >{kind === "git"
            ? "Repository URL or Path"
            : "Marketplace / Registry URL"}</label
        ><span class="text-[10px] text-gray-400 font-mono"
          >SSH, HTTPS or file://</span
        >
      </div>
      <Input
        id="source-url"
        label={kind === "git"
          ? "Repository URL or Path"
          : "Marketplace / Registry URL"}
        class="source-input"
        bind:value={location}
        placeholder={kind === "git"
          ? "https://github.com/org/repo.git or file:///path/to/folder"
          : "https://registry.example.com/v1"}
        required
      />
    </div>
    {#if kind === "git"}<div>
        <div class="flex items-center justify-between mb-1">
          <label
            class="block text-xs font-medium text-gray-700"
            for="source-branch">Branch or Tag</label
          ><span class="text-[10px] text-gray-400">Optional</span>
        </div>
        <Input
          id="source-branch"
          label="Branch or Tag"
          class="source-input"
          bind:value={branch}
          placeholder="main"
        />
      </div>{/if}
    <div class="flex items-center justify-between pt-1">
      <div>
        <span class="text-xs font-medium text-gray-800 block"
          >Check updates on launch</span
        ><span class="text-[10px] text-gray-500"
          >Automatically pull latest versions when workspace opens</span
        >
      </div>
      <Toggle label="Check updates on launch" bind:checked={autoUpdate} />
    </div>
    {#if error}<p role="alert" class="text-xs text-rose-600">{error}</p>{/if}
    <div class="pt-4 flex items-center justify-end gap-2">
      <Button
        class="px-3.5 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition"
        onclick={onclose}>Cancel</Button
      ><Button
        type="submit"
        title="Add a local draft only; no source will be connected"
        class="px-4 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg shadow-sm transition active:scale-[0.98]"
        >Add Source</Button
      >
    </div>
  </form>
</Modal>
