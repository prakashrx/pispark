<script lang="ts">
  let { segment }: { segment: { patch?: string } } = $props();
</script>

<p>Custom diff of {segment.patch?.length} characters</p>
