<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="flex flex-col items-end space-y-1.5" data-purpose="user-turn">
  <span class="text-[11px] font-mono font-medium text-zinc-600">You</span>
  <div
    class="max-w-2xl px-5 py-3 rounded-2xl bg-zinc-900 text-white text-sm font-normal shadow-elevation-md leading-relaxed tracking-wide"
  >
    {text}
  </div>
</div>
