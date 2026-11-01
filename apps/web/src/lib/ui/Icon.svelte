<script lang="ts">
  import { icons, type IconName } from "./icons";
  let { name, class: className = "" }: { name: IconName; class?: string } =
    $props();
</script>

<svg
  class={className}
  aria-hidden="true"
  fill="none"
  stroke="currentColor"
  viewBox="0 0 24 24"
>
  {#each icons[name] as shape}<svelte:element
      this={shape.tag}
      {...shape.attrs}
    />{/each}
</svg>
