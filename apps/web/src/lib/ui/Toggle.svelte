<script lang="ts">
  let {
    label,
    checked = $bindable(false),
    disabled = false,
    help,
  }: {
    label: string;
    checked?: boolean;
    disabled?: boolean;
    help?: string;
  } = $props();
  const id = $props.id();
</script>

<label
  class="relative inline-flex items-center cursor-pointer"
  class:opacity-50={disabled}
>
  <input
    type="checkbox"
    role="switch"
    {disabled}
    aria-describedby={help ? `${id}-help` : undefined}
    class="toggle-input absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0"
    aria-label={label}
    bind:checked
  />
  <span class="toggle-track" aria-hidden="true"></span>
  {#if help}<span id={`${id}-help`} class="ml-2 text-xs text-neutral-500"
      >{help}</span
    >{/if}
</label>

<style>
  /* Off: a quiet track with a raised knob. On: the theme accent, knob in its
     on-fill color so it reads on every theme. Focus uses the shared ring. */
  .toggle-track {
    position: relative;
    display: inline-block;
    width: 2rem;
    height: 1rem;
    border-radius: 9999px;
    background: var(--input);
    transition: background 0.15s;
  }
  .toggle-track::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 9999px;
    background: var(--background);
    box-shadow: var(--shadow-sm);
    transition: transform 0.15s;
  }
  .toggle-input:checked + .toggle-track {
    background: var(--interactive);
  }
  .toggle-input:checked + .toggle-track::after {
    transform: translateX(1rem);
    background: var(--interactive-foreground);
  }
  .toggle-input:focus-visible + .toggle-track {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
</style>
