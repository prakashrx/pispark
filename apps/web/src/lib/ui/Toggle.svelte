<script lang="ts">
  let {
    label,
    checked = $bindable(false),
  }: { label: string; checked?: boolean } = $props();
</script>

<label class="relative inline-flex items-center cursor-pointer">
  <input
    type="checkbox"
    class="absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 peer"
    aria-label={label}
    bind:checked
  />
  <span
    class="w-8 h-4 bg-gray-200 rounded-full peer peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-neutral-900"
  ></span>
</label>
