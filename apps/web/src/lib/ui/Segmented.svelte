<script lang="ts">
  /** A small exclusive choice rendered as one pill track. Native radios keep arrow-key behavior. */
  let {
    label,
    options,
    value = $bindable(""),
    onchange,
  }: {
    label: string;
    options: { value: string; label: string; style?: string }[];
    value?: string;
    onchange?: (value: string) => void;
  } = $props();
  const name = $props.id();
</script>

<div class="segmented" role="radiogroup" aria-label={label}>
  {#each options as option (option.value)}
    <label class="segment" style={option.style}>
      <input
        type="radio"
        {name}
        value={option.value}
        checked={value === option.value}
        onchange={() => {
          value = option.value;
          onchange?.(option.value);
        }}
      />
      <span>{option.label}</span>
    </label>
  {/each}
</div>

<style>
  .segmented {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.125rem;
    padding: 0.1875rem;
    border-radius: var(--radius-full);
    background: var(--muted);
  }
  .segment {
    position: relative;
    display: inline-flex;
  }
  .segment input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .segment span {
    padding: 0.3125rem 0.875rem;
    border-radius: var(--radius-full);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted-foreground);
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }
  .segment:hover span {
    color: var(--foreground);
  }
  .segment input:checked + span {
    background: var(--control-selected);
    color: var(--foreground);
    box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
  }
  .segment input:focus-visible + span {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
</style>
