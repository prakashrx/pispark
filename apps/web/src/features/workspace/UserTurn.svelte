<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="flex justify-end" data-purpose="user-turn">
  <div class="user-bubble">
    {text}
  </div>
</div>

<style>
  .user-bubble {
    max-width: min(36rem, 80%);
    padding: 0.625rem 1.125rem;
    background: var(--bubble);
    color: var(--foreground);
    border-radius: var(--radius-xl);
    font-family: var(--font-reading);
    font-size: 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
