<script lang="ts">
  type Call = { status: string; args: { word?: string }; result?: { details?: { loud?: string } } };
  let { call }: { call: Call } = $props();
</script>

<p class="shout">
  {#if call.status === "done"}Shouted {call.result?.details?.loud}{:else}Shouting {call.args.word}…{/if}
</p>
