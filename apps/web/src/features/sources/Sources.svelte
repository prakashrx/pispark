<script lang="ts">
  import SettingsPage from "../../lib/ui/SettingsPage.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
</script>

<SettingsPage
  title="Sources"
  description="Places to find personas and skills."
  label="Sources"
>
  <div class="settings-card empty">
    <span class="empty-icon" aria-hidden="true"
      ><Icon name="settingsFolder" class="w-6 h-6" /></span
    >
    <div>
      <p class="text-[0.9375rem] font-medium">Not available yet</p>
      <p class="text-sm text-muted-foreground mt-1 max-w-md">
        Source connections aren’t available yet. You can use local personas and
        skills in Personas.
      </p>
      <a href="#/persona" class="settings-link mt-3">Manage personas<span aria-hidden="true">→</span></a>
    </div>
  </div>
</SettingsPage>

<style>
  .empty {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    padding: 1.5rem;
  }
  .empty-icon {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background: var(--interactive-muted);
    color: var(--interactive-text);
  }
</style>
