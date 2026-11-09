<script lang="ts">
  import Label from "./Label.svelte";

  let { count, emit }: { count: number; emit: (name: string, data?: unknown) => void } = $props();
  let presses = $state(0);
</script>

<div class="counter">
  <Label text={`Count ${count}`} />
  <button type="button" onclick={() => (presses++, emit("view-fixture:add", { by: 1 }))}>Add one</button>
  <span class="presses">{presses} pressed here</span>
</div>

<style>
  .counter {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    color: var(--interactive-text);
  }
</style>
