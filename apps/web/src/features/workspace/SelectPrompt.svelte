<script lang="ts">
  /** Pick one of a list. Long lists get a filter; the first nine answer to their number. */
  let { options, onanswer }: { options: string[]; onanswer: (value: string) => void } = $props();

  const FILTER_FROM = 8;
  let query = $state("");
  let list = $state<HTMLElement>();
  let filter = $state<HTMLInputElement>();
  const shown = $derived(
    options.filter((option) => !query.trim() || option.toLowerCase().includes(query.trim().toLowerCase())),
  );
  /** "Label — what it does": the label leads and the rest reads as a second, quieter line. */
  const split = (option: string) => {
    const at = option.search(/\s[—–]\s/);
    return at > 0 ? [option.slice(0, at), option.slice(at).replace(/^\s[—–]\s/, "")] : [option, ""];
  };
  const items = () => [...(list?.querySelectorAll<HTMLElement>("[data-option]") ?? [])];

  function keydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    const typing = target instanceof HTMLInputElement;
    const rows = items();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const down = event.key === "ArrowDown";
      if (!rows.length) return;
      event.preventDefault();
      if (typing) return void rows[down ? 0 : rows.length - 1]?.focus();
      const index = rows.indexOf(target.closest<HTMLElement>("[data-option]")!);
      if (index < 0) return;
      if (!down && index === 0 && filter) return void filter.focus();
      rows[(index + (down ? 1 : rows.length - 1)) % rows.length]?.focus();
    } else if ((event.key === "Home" || event.key === "End") && !typing) {
      event.preventDefault();
      rows[event.key === "Home" ? 0 : rows.length - 1]?.focus();
    } else if (event.key === "Enter" && typing && shown[0] !== undefined) {
      event.preventDefault();
      onanswer(shown[0]);
    } else if (!typing && /^[1-9]$/.test(event.key) && shown[Number(event.key) - 1] !== undefined) {
      event.preventDefault();
      onanswer(shown[Number(event.key) - 1]!);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="select" onkeydown={keydown}>
  {#if options.length >= FILTER_FROM}
    <input class="filter" type="search" aria-label="Filter options" placeholder="Type to filter…" bind:value={query} bind:this={filter} data-autofocus />
  {/if}
  <div class="options" bind:this={list}>
    {#each shown as option, index (option)}
      {@const [label, detail] = split(option)}
      <button type="button" class="option" data-option data-autofocus={options.length < FILTER_FROM && index === 0 ? "" : undefined} onclick={() => onanswer(option)}>
        <span class="number" aria-hidden="true">{index < 9 ? index + 1 : ""}</span>
        <span class="text"><span>{label}</span>{#if detail}<span class="detail">{detail}</span>{/if}</span>
      </button>
    {:else}
      <p class="none" role="status">Nothing matches “{query}”.</p>
    {/each}
  </div>
</div>

<style>
  .select {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .filter {
    width: 100%;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--input);
    border-radius: var(--radius);
    background: var(--background);
    color: var(--foreground);
    font: inherit;
    font-size: 0.875rem;
  }
  .filter:focus-visible {
    outline: none;
    border-color: var(--interactive);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive) 25%, transparent);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    max-height: 15rem;
    overflow-y: auto;
  }
  .option {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.4rem 0.625rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .option:hover,
  .option:focus-visible {
    background: var(--muted);
  }
  .option:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -1px;
  }
  .number {
    flex: none;
    width: 1.25rem;
    font-size: 0.75rem;
    line-height: 1.6rem;
    text-align: center;
    color: var(--subtle-foreground);
    font-variant-numeric: tabular-nums;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .detail {
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .none {
    margin: 0;
    padding: 0.5rem 0.625rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }
</style>
