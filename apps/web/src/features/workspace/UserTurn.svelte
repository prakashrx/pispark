<script lang="ts">
  let { time, text }: { time: string; text: string } = $props();
</script>

<div class="flex flex-col items-end space-y-1.5" data-purpose="user-turn">
  <div class="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
    <span class="font-medium text-zinc-600">You</span>
    <span>{time}</span>
  </div>
  <div
    class="max-w-2xl px-5 py-3 rounded-2xl bg-zinc-900 text-white text-sm font-normal shadow-elevation-md leading-relaxed tracking-wide"
  >
    {text}
  </div>
</div>
