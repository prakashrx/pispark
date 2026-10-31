<script lang="ts">
  let draft = $state('');
  let notice = $state('');

  function preview(event: SubmitEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    notice = 'Demo only — nothing was sent. Pi SDK integration is the next step; no model or agent is connected.';
  }
</script>

<form class="composer" onsubmit={preview} aria-label="Demo composer">
  <label class="composer-label" for="ask">Ask PiSpark</label>
  <textarea
    id="ask"
    bind:value={draft}
    placeholder="What would you like to explore?"
    rows="3"
    maxlength="4000"
    aria-describedby="composer-help"
  ></textarea>
  <div class="composer-toolbar">
    <div class="composer-options">
      <label class="select-label">Persona
        <select disabled aria-label="Persona (not connected)"><option>Not configured</option></select>
      </label>
      <label class="select-label">Model
        <select disabled aria-label="Model (not connected)"><option>Not connected</option></select>
      </label>
    </div>
    <button class="primary-button" type="submit" disabled={!draft.trim()}>Preview demo <span aria-hidden="true">↑</span></button>
  </div>
</form>
<p class="composer-help" id="composer-help">A UI demo, not an agent yet. Your draft stays in this page and is not saved or sent.</p>
<p class="demo-notice" role="status">{notice}</p>
