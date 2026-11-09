<script lang="ts">
  type Host = { call: (name: string, data?: unknown) => Promise<unknown> };
  let { on, host }: { on: boolean; host: Host } = $props();
</script>

<button type="button" aria-pressed={on} onclick={() => host.call("flip")}>Fixture mode</button>
