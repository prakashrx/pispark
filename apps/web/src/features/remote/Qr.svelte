<script lang="ts">
  import { encode } from "uqr";
  /** A QR code for `text`, drawn dark on white whatever the theme, so any camera reads it. */
  let { text, label }: { text: string; label: string } = $props();
  const qr = $derived(encode(text, { ecc: "M", border: 2 }));
  const size = $derived(qr.data.length);
  const path = $derived(
    qr.data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ""))).join(""),
  );
</script>

<svg class="qr" viewBox="0 0 {size} {size}" shape-rendering="crispEdges" role="img" aria-label={label}>
  <rect width={size} height={size} fill="#fff" />
  <path d={path} fill="#111" />
</svg>

<style>
  .qr {
    width: 9.5rem;
    height: 9.5rem;
    flex-shrink: 0;
    border-radius: var(--radius-md);
  }
</style>
