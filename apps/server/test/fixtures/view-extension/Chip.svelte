<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<span class="chip">{text}</span>

<style>
  .chip {
    padding: 0.1rem 0.5rem;
    border-radius: var(--radius-full);
    background: var(--muted);
    font-size: 0.75rem;
  }
</style>
