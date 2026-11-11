<script lang="ts">
  // A static file of the extension: the import is its address.
  import mark from "./mark.svg";

  type Host = { call: (name: string, data?: unknown) => Promise<unknown>; file: (path: string) => string };
  let { title, host }: { title: string; host: Host } = $props();
  let items = $state<string[]>([]);
  let failed = $state("");
  // A data file from the folder the placement named.
  $effect(() => {
    fetch(host.file("items.json"))
      .then((response) => response.json())
      .then(
        (data: { items: string[] }) => (items = data.items),
        (error) => (failed = String(error)),
      );
  });
</script>

<section class="page" aria-label={title}>
  <h2><img src={mark} alt="Fixture mark" width="24" height="24" /> {title}</h2>
  <ul>
    {#each items as item (item)}<li>{item}</li>{/each}
  </ul>
  {#if failed}<p role="alert">{failed}</p>{/if}
</section>

<style>
  .page {
    flex: 1;
    padding: 1.5rem;
    color: var(--foreground);
    background: var(--muted);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
</style>
