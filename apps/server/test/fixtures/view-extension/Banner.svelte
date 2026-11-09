<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<p class="banner">{text}</p>

<style>
  .banner {
    margin: 0;
    color: var(--muted-foreground);
  }
</style>
