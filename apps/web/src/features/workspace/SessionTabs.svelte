<script lang="ts">
  import Segmented from "../../lib/ui/Segmented.svelte";
  import { useSession } from "./session-client.svelte";
  /** The switch between a session's views: PiSpark's conversation and the views extensions offer. */
  const session = useSession();
  const views = $derived([
    { value: "", label: "Conversation" },
    ...session.views.map((view) => ({ value: view.key, label: view.title ?? view.key })),
  ]);
</script>

{#if views.length > 1}<Segmented
    label="Show"
    options={views}
    value={session.shownView ?? ""}
    onchange={(key) => session.showView(key || undefined)}
  />{/if}
