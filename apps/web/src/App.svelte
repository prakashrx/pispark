<script lang="ts">
  import { onMount } from "svelte";
  import Shell from "./shell/Shell.svelte";
  import { focusMain } from "./lib/focus";
  import { provideSessions } from "./features/workspace/session-client.svelte";

  const sessions = provideSessions();
  onMount(() => {
    void sessions.mount();
    return () => sessions.dispose();
  });
</script>

<a
  href="#main"
  onclick={(event) => {
    event.preventDefault();
    focusMain();
  }}
  class="skip-link text-xs"
>
  Skip to content
</a>
<Shell />
