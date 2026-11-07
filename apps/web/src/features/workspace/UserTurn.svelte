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
    max-width: min(42rem, 85%);
    padding: 0.625rem 0.875rem;
    background: var(--muted);
    color: var(--foreground);
    border-radius: var(--radius-lg);
    font-size: 0.875rem;
    line-height: 1.6;
    word-break: break-words;
  }
</style>
