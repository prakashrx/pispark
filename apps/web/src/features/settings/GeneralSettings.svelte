<script lang="ts">
  import SettingsPage from "../../lib/ui/SettingsPage.svelte";
  import Section from "../../lib/ui/Section.svelte";
  import FieldRow from "../../lib/ui/FieldRow.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import ThemePicker from "../../lib/theme/ThemePicker.svelte";
  import { appearance } from "../../lib/theme/appearance.svelte";
  import { fonts, textSizes } from "../../lib/theme/themes";
  import { useSessions } from "../workspace/session-client.svelte";
  const client = useSessions();
  const fontOptions = fonts.map((font) => ({
    value: font.id,
    label: font.name,
    style: `font-family:${font.stack}`,
  }));
</script>

<SettingsPage
  title="General"
  description="Appearance and your workspace at a glance."
  label="General settings"
>
  <Section title="Theme" description="Saved in this browser. Changes apply instantly.">
    <div class="mt-4">
      <ThemePicker
        value={appearance.current.theme}
        onchange={(theme) => appearance.set({ theme })}
      />
    </div>
  </Section>

  <Section title="Typography" description="Fonts use what’s installed on this device.">
    <div class="settings-card mt-4">
      <FieldRow label="Interface font" description="Sidebar, controls and settings.">
        <Segmented
          label="Interface font"
          options={fontOptions}
          value={appearance.current.interfaceFont}
          onchange={(interfaceFont) => appearance.set({ interfaceFont })}
        />
      </FieldRow>
      <FieldRow label="Message font" description="Chat replies and your messages.">
        <Segmented
          label="Message font"
          options={fontOptions}
          value={appearance.current.messageFont}
          onchange={(messageFont) => appearance.set({ messageFont })}
        />
      </FieldRow>
      <FieldRow label="Text size" description="Scales text and spacing everywhere.">
        <Segmented
          label="Text size"
          options={textSizes.map((size) => ({ value: size.id, label: size.name }))}
          value={appearance.current.textSize}
          onchange={(textSize) => appearance.set({ textSize })}
        />
      </FieldRow>
      <div class="type-sample" aria-hidden="true">
        <p class="sample-title">The quick brown fox</p>
        <p class="sample-body">
          Replies render in your message font, sized for comfortable reading
          across long answers.
        </p>
      </div>
    </div>
  </Section>

  <Section title="Workspace" description="Chats can work in any folder on this computer.">
    <div class="settings-card mt-4">
      <FieldRow label="Recent folders" description="Choose a folder when you start a chat.">
        <div class="text-sm text-right space-y-1">
          {#if client.catalogLoading}<p role="status" class="text-muted-foreground">
              Loading…
            </p>
          {:else if client.catalogError}<p role="alert" class="text-[var(--danger-foreground)]">
              Couldn’t load folders. Try reconnecting.
            </p>
          {:else}{#each client.catalog.recentFolders as folder}<p class="inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-3 py-1 font-medium" title={folder}>
                <Icon name="folder" class="w-3.5 h-3.5" />{folder}
              </p>{:else}<p class="text-muted-foreground">None yet. New chats start in your home folder.</p>{/each}{/if}
        </div>
      </FieldRow>
      <FieldRow label="Default persona" description="Skills, tools and instructions every chat starts with.">
        <a
          class="settings-link"
          href="#/persona"
          onclick={() => void client.personas.open({ persona: "default" })}>Edit Default</a
        >
      </FieldRow>
      <FieldRow label="Personas" description="Reusable setups built on Default.">
        <a
          class="settings-link"
          href="#/persona"
          onclick={() => client.personas.collection()}>Manage personas</a
        >
      </FieldRow>
      <FieldRow label="Providers &amp; models" description="Connect an account and choose a model.">
        <a class="settings-link" href="#/providers">Providers &amp; models</a>
      </FieldRow>
    </div>
  </Section>
</SettingsPage>

<style>
  .type-sample {
    padding: 1rem 1.25rem 1.25rem;
    background: var(--code-surface);
  }
  .sample-title {
    font-family: var(--font-sans);
    font-size: 1.125rem;
    font-weight: 600;
  }
  .sample-body {
    margin-top: 0.25rem;
    font-family: var(--font-reading);
    font-size: 1rem;
    line-height: 1.7;
    color: var(--muted-foreground);
  }
</style>
