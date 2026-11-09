<script lang="ts">
  import Label from "./Label.svelte";

  type Host = { call: (name: string, data?: unknown) => Promise<unknown> };
  let { count, host }: { count: number; host: Host } = $props();
  let presses = $state(0);
  let message = $state("");

  async function add() {
    presses++;
    message = `Now ${await host.call("add", 1)}`;
  }
  async function jam() {
    try {
      await host.call("jam");
    } catch (error) {
      message = (error as Error).message;
    }
  }
</script>

<div class="counter">
  <Label text={`Count ${count}`} />
  <button type="button" onclick={add}>Add one</button>
  <button type="button" onclick={jam}>Jam it</button>
  <span class="presses">{presses} pressed here</span>
  {#if message}<span class="message">{message}</span>{/if}
</div>

<style>
  .counter {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: var(--interactive-text);
  }
</style>
