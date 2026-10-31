<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import Composer from './components/Composer.svelte';
  import HealthStatus from './components/HealthStatus.svelte';

  let sidebarOpen = $state(true);
</script>

<a class="skip-link" href="#workspace">Skip to workspace</a>
<div class="app-shell" class:sidebar-open={sidebarOpen}>
  {#if sidebarOpen}<Sidebar />{/if}
  <div class="workspace-shell">
    <header class="topbar">
      <div class="topbar-start">
        <button
          class="quiet-button sidebar-toggle"
          type="button"
          onclick={() => { sidebarOpen = !sidebarOpen; }}
          aria-expanded={sidebarOpen}
          aria-controls="workspace-sidebar"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        ><span aria-hidden="true">☰</span></button>
        <span class="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></span>
      </div>
      <HealthStatus />
    </header>

    <main id="workspace" tabindex="-1">
      <section class="welcome" aria-labelledby="welcome-heading">
        <p class="eyebrow"><span aria-hidden="true">✦</span> ROOM FOR YOUR NEXT IDEA</p>
        <h1 id="welcome-heading">Start with a spark.</h1>
        <p class="intro">A quieter place to think, build, and make things your own.<br class="desktop-break" /> Your workspace is taking shape.</p>
        <Composer />
      </section>

      <section class="foundation" aria-labelledby="foundation-heading">
        <div class="section-heading">
          <div><p class="section-label">SMALL BEGINNINGS</p><h2 id="foundation-heading">The foundation is here.</h2></div>
          <span class="small-badge">STARTER</span>
        </div>
        <div class="feature-grid">
          <article class="feature-card">
            <span class="feature-number">01 / CONNECTED</span>
            <h3>A real heartbeat</h3>
            <p>The indicator above checks the Node backend. One small, working connection to build on.</p>
          </article>
          <article class="feature-card">
            <span class="feature-number">02 / EXPLORING</span>
            <h3>A space to shape</h3>
            <p>A responsive Svelte shell and a local-only demo composer. No generated answers or hidden requests.</p>
          </article>
          <article class="feature-card future-card">
            <span class="feature-number">03 / UP NEXT</span>
            <h3>The agent comes next</h3>
            <p>Pi SDK integration, then backend-owned sessions and composable personas. Direction, not features yet.</p>
          </article>
        </div>
      </section>
      <footer class="workspace-footer"><span>Made for possibility. Kept simple on purpose.</span><a href="https://github.com/prakashrx/pispark/blob/main/docs/product-direction.md">Read the direction <span aria-hidden="true">↗</span></a></footer>
    </main>
  </div>
</div>
