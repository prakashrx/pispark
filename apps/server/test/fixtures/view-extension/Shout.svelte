<script lang="ts">
  type Call = { status: string; args: { word?: string }; result?: { details?: { loud?: string } } };
  let { data }: { data: Call } = $props();
</script>

<p class="shout">
  {#if data.status === "done"}Shouted {data.result?.details?.loud}{:else}Shouting {data.args.word}…{/if}
</p>
