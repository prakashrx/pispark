<script lang="ts">
  import { onMount } from 'svelte';

  let healthState = $state<'checking' | 'online' | 'offline'>('checking');
  let checking = $state(false);
  let activeRequest: AbortController | undefined;
  const labels = { checking: 'Checking backend', online: 'Backend online', offline: 'Backend unavailable' };

  async function checkHealth() {
    if (checking) return;
    checking = true;
    const controller = new AbortController();
    activeRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
      const body: unknown = await response.json();
      healthState = response.ok && typeof body === 'object' && body !== null
        && 'status' in body && body.status === 'ok'
        && 'service' in body && body.service === 'pispark' ? 'online' : 'offline';
    } catch {
      healthState = 'offline';
    } finally {
      clearTimeout(timeout);
      checking = false;
      activeRequest = undefined;
    }
  }

  onMount(() => {
    void checkHealth();
    const interval = setInterval(() => { void checkHealth(); }, 30000);
    return () => { clearInterval(interval); activeRequest?.abort(); };
  });
</script>

<div class="health-status">
  <span class="health-label" role="status"><span class="status-dot" class:online={healthState === 'online'} aria-hidden="true"></span>{labels[healthState]}</span>
  <button class="quiet-button" type="button" onclick={checkHealth} disabled={checking} aria-label="Refresh backend health" title="Checks the server, not an agent connection">↻</button>
</div>
