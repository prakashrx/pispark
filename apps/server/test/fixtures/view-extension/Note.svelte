<script lang="ts">
  let { data }: { data: { details?: { text?: string } } } = $props();
</script>

<p class="note">Note: {data.details?.text}</p>
