<script lang="ts">
  import Menu from "../../lib/ui/Menu.svelte";
  let {
    index,
    count,
    label,
    move,
    remove,
    disabled = false,
    onadvanced,
  }: {
    index: number;
    count: number;
    label: string;
    move: (from: number, to: number) => void;
    remove: () => void;
    disabled?: boolean;
    onadvanced?: () => void;
  } = $props();
</script>

<Menu
  label={`${label} actions`}
  {disabled}
  items={[
    {
      id: "up",
      label: "Move up",
      disabled: index === 0,
      onselect: () => move(index, index - 1),
    },
    {
      id: "down",
      label: "Move down",
      disabled: index === count - 1,
      onselect: () => move(index, index + 1),
    },
    ...(onadvanced
      ? [{ id: "advanced", label: "Advanced settings", onselect: onadvanced }]
      : []),
    { id: "remove", label: "Remove", destructive: true, onselect: remove },
  ]}
  >{#snippet trigger()}<span aria-hidden="true" class="text-lg leading-none"
      >⋯</span
    >{/snippet}</Menu
>
