<script lang="ts">
  /** A small whole number with − and + (design language §3): one step at a time, within its range. */
  let {
    label,
    value,
    min = 1,
    max = 99,
    disabled = false,
    onchange,
  }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    onchange: (value: number) => void;
  } = $props();
</script>

<span class="stepper" role="group" aria-label={label}>
  <button type="button" aria-label="Fewer" disabled={disabled || value <= min} onclick={() => onchange(value - 1)}>−</button>
  <span class="value" aria-live="polite">{value}</span>
  <button type="button" aria-label="More" disabled={disabled || value >= max} onclick={() => onchange(value + 1)}>+</button>
</span>

<style>
  .stepper {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  button {
    width: 2.25rem;
    height: 2.25rem;
    display: grid;
    place-items: center;
    border-radius: var(--radius);
    font-size: var(--text-base);
    color: var(--muted-foreground);
  }
  button:hover:not(:disabled) {
    background: var(--accent);
    color: var(--foreground);
  }
  button:disabled {
    opacity: 0.4;
  }
  .value {
    min-width: 2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  :global([data-size="compact"]) button {
    width: 2.75rem;
    height: 2.75rem;
  }
</style>
