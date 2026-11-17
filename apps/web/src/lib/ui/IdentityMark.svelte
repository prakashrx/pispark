<script lang="ts" module>
  const HUES = [250, 160, 25, 300, 200, 45, 340, 120];
  /** A steady hue for a name, so the same name always gets the same colour. */
  export function nameHue(name: string): number {
    let hash = 0;
    for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    return HUES[hash % HUES.length]!;
  }
</script>

<script lang="ts">
  /**
   * Who or what something is: its initial on a tile in its own hue, so colour means "which
   * one", never state. Decorative; the name beside it carries the meaning.
   */
  let { name, size = "sm" }: { name: string; size?: "sm" | "md" | "lg" } = $props();
  const initial = $derived([...name.trim()][0]?.toUpperCase() ?? "");
</script>

<span class="identity hue-tint" data-size={size} style:--h={nameHue(name)} aria-hidden="true">{initial}</span>

<style>
  .identity {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.375rem;
    height: 1.375rem;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1;
  }
  [data-size="md"] {
    width: 2rem;
    height: 2rem;
    font-size: var(--text-md);
  }
  [data-size="lg"] {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--radius-md);
    font-size: var(--text-xl);
  }
</style>
