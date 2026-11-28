<script lang="ts">
  /** Settings → Appearance (set 6): theme, text size and fonts, saved in this browser. */
  import Card from "../../lib/ui/Card.svelte";
  import CardRow from "../../lib/ui/CardRow.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import ThemePicker from "../../lib/theme/ThemePicker.svelte";
  import { appearance } from "../../lib/theme/appearance.svelte";
  import { fonts, textSizes } from "../../lib/theme/themes";

  const fontOptions = fonts.map((font) => ({ value: font.id, label: font.name, style: `font-family:${font.stack}` }));
  const size = $derived(
    Math.max(
      0,
      textSizes.findIndex((s) => s.id === appearance.current.textSize),
    ),
  );
</script>

<Card title="Theme" wide>
  <div class="pad"><ThemePicker value={appearance.current.theme} onchange={(theme) => appearance.set({ theme })} /></div>
</Card>

<Card title="Text size" note={textSizes[size]?.name} wide>
  <div class="pad">
    <input
      class="slider"
      type="range"
      min="0"
      max={textSizes.length - 1}
      step="1"
      value={size}
      aria-label="Text size"
      aria-valuetext={textSizes[size]?.name}
      oninput={(event) => appearance.set({ textSize: textSizes[Number(event.currentTarget.value)]!.id })}
    />
    <p class="sample">Replies and your messages read at this size.</p>
  </div>
</Card>

<Card title="Fonts" wide>
  <CardRow label="Interface">
    <Segmented
      label="Interface font"
      options={fontOptions}
      value={appearance.current.interfaceFont}
      onchange={(interfaceFont) => appearance.set({ interfaceFont })}
    />
  </CardRow>
  <CardRow label="Messages">
    <Segmented
      label="Message font"
      options={fontOptions}
      value={appearance.current.messageFont}
      onchange={(messageFont) => appearance.set({ messageFont })}
    />
  </CardRow>
</Card>

<style>
  .pad {
    padding: 0.75rem 1rem 1rem;
  }
  .slider {
    width: 100%;
    accent-color: var(--foreground);
  }
  .sample {
    margin-top: 0.5rem;
    font-family: var(--font-reading);
    font-size: var(--text-base);
    color: var(--muted-foreground);
  }
</style>
