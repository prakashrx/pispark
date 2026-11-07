<script lang="ts">
  import { themes, systemThemes, type Theme } from "./themes";
  let {
    value,
    onchange,
  }: { value: string; onchange: (id: string) => void } = $props();
  const name = $props.id();
  const light = themes.find((t) => t.id === systemThemes.light)!;
  const dark = themes.find((t) => t.id === systemThemes.dark)!;
  const choices: { id: string; name: string; description: string; mode: string; preview: Theme[] }[] = [
    {
      id: "system",
      name: "System",
      description: `${light.name} or ${dark.name}, following your device`,
      mode: "Auto",
      preview: [light, dark],
    },
    ...themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      description: theme.description,
      mode: theme.mode === "light" ? "Light" : "Dark",
      preview: [theme],
    })),
  ];
</script>

<div class="theme-grid" role="radiogroup" aria-label="Theme">
  {#each choices as choice (choice.id)}
    <label class="theme-card">
      <input
        type="radio"
        {name}
        value={choice.id}
        checked={value === choice.id}
        aria-describedby={`${name}-${choice.id}`}
        onchange={() => onchange(choice.id)}
      />
      <span class="preview" aria-hidden="true">
        {#each choice.preview as theme}
          {@const [surface, sidebar, text, accent] = theme.swatch}
          <span class="pane" style={`background:${surface}`}>
            <span class="mini-sidebar" style={`background:${sidebar}`}>
              <span style={`background:${text};opacity:.5`}></span>
              <span style={`background:${text};opacity:.25`}></span>
              <span style={`background:${text};opacity:.25`}></span>
            </span>
            <span class="mini-body">
              <span class="mini-bubble" style={`background:${text};opacity:.12`}></span>
              <span class="mini-line" style={`background:${text};opacity:.55`}></span>
              <span class="mini-line short" style={`background:${text};opacity:.3`}></span>
              <span class="mini-composer" style={`border-color:${text}33`}>
                <span style={`background:${accent}`}></span>
              </span>
            </span>
          </span>
        {/each}
      </span>
      <span class="meta">
        <span class="name">{choice.name}<span class="mode">{choice.mode}</span></span>
        <span id={`${name}-${choice.id}`} class="description">{choice.description}</span>
      </span>
    </label>
  {/each}
</div>

<style>
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
    gap: 0.875rem;
  }
  .theme-card {
    position: relative;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--card);
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
  }
  .theme-card:hover {
    border-color: var(--input);
    transform: translateY(-1px);
  }
  .theme-card input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .theme-card:has(input:checked) {
    border-color: var(--interactive);
    box-shadow: 0 0 0 1px var(--interactive);
  }
  .theme-card:has(input:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .preview {
    display: flex;
    height: 5.25rem;
    border-bottom: 1px solid var(--border);
  }
  .pane {
    flex: 1;
    display: flex;
    min-width: 0;
  }
  .mini-sidebar {
    width: 28%;
    padding: 0.5rem 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .mini-sidebar span {
    height: 0.25rem;
    border-radius: 9999px;
  }
  .mini-body {
    flex: 1;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .mini-bubble {
    align-self: flex-end;
    width: 45%;
    height: 0.5rem;
    border-radius: 9999px;
  }
  .mini-line {
    height: 0.25rem;
    width: 85%;
    border-radius: 9999px;
  }
  .mini-line.short {
    width: 60%;
  }
  .mini-composer {
    margin-top: auto;
    height: 0.8rem;
    border: 1px solid;
    border-radius: 9999px;
    display: flex;
    justify-content: flex-end;
    padding: 0.1rem;
  }
  .mini-composer span {
    width: 0.55rem;
    border-radius: 50%;
  }
  .meta {
    padding: 0.625rem 0.75rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .name {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
  }
  .mode {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--subtle-foreground);
  }
  .theme-card:has(input:checked) .mode {
    color: var(--interactive-text);
  }
  .description {
    font-size: 0.75rem;
    line-height: 1.4;
    color: var(--muted-foreground);
  }
</style>
