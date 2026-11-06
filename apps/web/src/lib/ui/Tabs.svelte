<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    label,
    tabs,
    value = $bindable(""),
    children,
  }: {
    label: string;
    tabs: { id: string; label: string; disabled?: boolean }[];
    value?: string;
    children: Snippet<[string]>;
  } = $props();
  const id = $props.id();
  let root: HTMLDivElement;
  const selected = $derived(
    value || tabs.find((tab) => !tab.disabled)?.id || "",
  );
  function navigate(event: KeyboardEvent, current: string) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.id === current);
    const next =
      event.key === "Home"
        ? enabled[0]
        : event.key === "End"
          ? enabled.at(-1)
          : enabled[
              (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) %
                enabled.length
            ];
    if (next) {
      value = next.id;
      root
        .querySelector<HTMLButtonElement>(
          `[data-tab-index="${tabs.indexOf(next)}"]`,
        )
        ?.focus();
    }
  }
</script>

<div bind:this={root}>
  <div
    role="tablist"
    aria-label={label}
    class="flex gap-1 border-b border-neutral-200 mb-5"
  >
    {#each tabs as tab, index (tab.id)}
      <button
        type="button"
        role="tab"
        id={`${id}-tab-${tab.id}`}
        data-tab-index={index}
        aria-controls={`${id}-panel-${tab.id}`}
        aria-selected={selected === tab.id}
        tabindex={selected === tab.id ? 0 : -1}
        disabled={tab.disabled}
        onclick={() => (value = tab.id)}
        onkeydown={(event) => navigate(event, tab.id)}
        class="px-3 py-2 text-xs font-medium border-b-2 border-transparent text-neutral-500 disabled:opacity-50"
        class:!border-neutral-900={selected === tab.id}
        class:!text-neutral-900={selected === tab.id}>{tab.label}</button
      >
    {/each}
  </div>
  {#each tabs as tab (tab.id)}
    <div
      role="tabpanel"
      id={`${id}-panel-${tab.id}`}
      aria-labelledby={`${id}-tab-${tab.id}`}
      hidden={selected !== tab.id}
      tabindex="0"
    >
      {@render children(tab.id)}
    </div>
  {/each}
</div>
