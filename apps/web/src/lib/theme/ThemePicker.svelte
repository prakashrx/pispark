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
      <span class="name">{choice.name}</span>
      <span id={`${name}-${choice.id}`} class="sr-only">{choice.mode}: {choice.description}</span>
    </label>
  {/each}
</div>

<style>
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.25rem, 1fr));
    gap: 0.5rem;
  }
  .theme-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.25rem;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
  }
  .theme-card:hover {
    background: var(--accent);
  }
  .theme-card input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    cursor: pointer;
  }
  .theme-card:has(input:checked) {
    border-color: var(--foreground);
  }
  .theme-card:has(input:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  .preview {
    display: flex;
    height: 3.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .pane {
    flex: 1;
    display: flex;
    min-width: 0;
  }
  .mini-sidebar {
    width: 28%;
    padding: 0.35rem 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .mini-sidebar span {
    height: 0.25rem;
    border-radius: 9999px;
  }
  .mini-body {
    flex: 1;
    padding: 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
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
    height: 0.6rem;
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
  .name {
    font-size: var(--text-xs);
    text-align: center;
    color: var(--foreground);
  }
</style>
