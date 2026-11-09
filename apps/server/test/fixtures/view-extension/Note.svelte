<script lang="ts">
  let { item }: { item: { details?: { text?: string } } } = $props();
</script>

<p class="note">Note: {item.details?.text}</p>
