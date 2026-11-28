<script lang="ts">
  import Card from "../../lib/ui/Card.svelte";
  import CardRow from "../../lib/ui/CardRow.svelte";
  import Segmented from "../../lib/ui/Segmented.svelte";
  import Toggle from "../../lib/ui/Toggle.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import Markdown from "../../lib/markdown/Markdown.svelte";
  import { useSessions } from "../workspace/session-client.svelte";
  import { formatBytes } from "../../lib/bytes";
  import type { HostAction, ReleaseChannel } from "../../../../server/src/contract/host-protocol";
  import { useNow } from "../../lib/clock.svelte";
  /** Settings → About (set 6): its updates, and this PiSpark: version and where it runs. */
  const client = useSessions();
  const host = client.host;
  const status = $derived(host.status);
  const launcher = $derived(status?.launcher);
  const update = $derived(launcher?.update);
  const running = $derived(status?.running ?? { replies: [], processes: [] });
  const busy = $derived(running.replies.length + running.processes.length > 0);
  /** Asked to restart while something runs: say what, and offer to wait. */
  let confirming = $state(false);
  let error = $state("");
  let acting = $state(false);
  // "Checked 3 min ago" needs no finer clock.
  const clock = useNow(() => true, 30_000);
  /** What is new in this version, unfolded under its Version row. */
  let showNotes = $state(false);
  $effect(() => {
    void host.refresh().catch(() => {});
    void host.readNotes();
  });
  async function act(action: HostAction) {
    error = "";
    acting = true;
    try {
      await host.act(action);
    } catch {
      error = "PiSpark couldn’t pass that on to its launcher. Try again.";
    } finally {
      acting = false;
    }
  }
  function restart() {
    if (busy) confirming = true;
    else void act({ action: "apply", when: "now" });
  }
  function ago(at: string) {
    const minutes = Math.max(0, Math.round((clock.now - Date.parse(at)) / 60_000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} hour${hours === 1 ? "" : "s"} ago` : new Date(at).toLocaleDateString();
  }
</script>

{#if status?.managed && launcher && update}
  <Card title="Updates">
    <div class="status">
      {#if launcher.kept && !host.restarting && update.phase !== "restarting"}
        <div class="notice" role="status">
          <Icon name="pin" class="w-4 h-4 shrink-0" />
          <span class="flex-1"><strong>Kept at v{launcher.kept}.</strong> PiSpark doesn’t check for updates until you resume them.</span>
          <Button size="compact" disabled={acting} onclick={() => void act({ action: "resume" })}>Resume updates</Button>
        </div>
      {:else if update.phase === "restarting" || host.restarting}
        <div class="notice" role="status">
          <span class="spin" aria-hidden="true"></span><span
            ><strong>Updating to v{host.restarting ?? (update.phase === "restarting" ? update.version : "")}…</strong> Back in a few seconds.</span
          >
        </div>
      {:else if update.phase === "available" || update.phase === "waiting"}
        <div class="notice" role="status">
          <Icon name="arrowUp" class="w-4 h-4 shrink-0" />
          <span class="flex-1"
            >{#if update.phase === "waiting"}<strong>v{update.version} installs when nothing is running.</strong>
              It checks again every 30 seconds.{:else}<strong>v{update.version} is available.</strong> Your sessions stay through the restart.{/if}</span
          >
          <span class="flex gap-2">
            {#if update.phase === "available" && update.notes}<a class="link" href={update.notes} target="_blank" rel="noreferrer"
                >What’s new</a
              >{/if}
            {#if update.phase === "waiting"}
              <Button size="compact" disabled={acting} onclick={() => void act({ action: "apply", when: "now" })}>Update now</Button>
              <Button size="compact" variant="ghost" disabled={acting} onclick={() => void act({ action: "cancel" })}>Cancel</Button>
            {:else}
              <Button size="compact" variant="primary" disabled={acting} onclick={restart}>Update</Button>
            {/if}
          </span>
        </div>
        {#if confirming && update.phase === "available"}
          <div class="notice block" role="group" aria-labelledby="running-title">
            <p id="running-title" class="flex items-center gap-2 font-semibold">
              <Icon name="alert" class="w-4 h-4" />Something is running
            </p>
            <ul class="running">
              {#each running.replies as reply (reply.session)}<li>
                  <Icon name="thought" class="w-4 h-4 text-muted-foreground" />A reply in “{reply.title}”<span
                    class="text-muted-foreground"
                  >
                    · would be interrupted</span
                  >
                </li>{/each}
              {#each running.processes as process (process.session + process.name)}<li>
                  <Icon name="terminal" class="w-4 h-4 text-muted-foreground" />{process.name} in “{process.title}”<span
                    class="text-muted-foreground"
                  >
                    · would stop; the agent is told</span
                  >
                </li>{/each}
            </ul>
            <div class="flex flex-wrap gap-2 mt-3">
              <Button
                size="compact"
                variant="primary"
                disabled={acting}
                onclick={() => ((confirming = false), void act({ action: "apply", when: "idle" }))}>Update when idle</Button
              >
              <Button size="compact" disabled={acting} onclick={() => ((confirming = false), void act({ action: "apply", when: "now" }))}
                >Update now</Button
              >
              <Button size="compact" variant="ghost" onclick={() => (confirming = false)}>Cancel</Button>
            </div>
          </div>
        {/if}
      {:else if update.phase === "checking"}
        <div class="notice" role="status"><span class="spin" aria-hidden="true"></span><span>Checking for updates…</span></div>
      {:else if update.phase === "downloading"}
        <div class="notice" role="status">
          <span class="spin" aria-hidden="true"></span><span
            >Downloading v{update.version}… {formatBytes(update.received)}{update.total ? ` of ${formatBytes(update.total)}` : ""}</span
          >
        </div>
      {:else if update.phase === "failed"}
        <div class="notice" role="alert">
          <Icon name="alert" class="w-4 h-4 shrink-0" />
          <span class="flex-1"
            ><strong>The update to v{update.version} didn’t start.</strong> PiSpark went back to v{status.version}, and v{update.version} won’t
            be offered again. <span class="text-muted-foreground">{update.reason}</span></span
          >
          <Button size="compact" variant="ghost" disabled={acting} onclick={() => void act({ action: "check" })}>Check again</Button>
        </div>
      {:else if update.phase === "error"}
        <div class="notice" role="alert">
          <Icon name="alert" class="w-4 h-4 shrink-0" />
          <span class="flex-1"
            ><strong>Couldn’t check for updates.</strong> <span class="text-muted-foreground">{update.message}</span></span
          >
          <Button size="compact" variant="ghost" disabled={acting} onclick={() => void act({ action: "check" })}>Try again</Button>
        </div>
      {:else}
        <div class="notice" role="status">
          <Icon name={update.phase === "current" ? "check" : "info"} class="w-4 h-4 shrink-0" />
          <span class="flex-1">{update.phase === "current" ? `Up to date · checked ${ago(update.checkedAt)}` : "Not checked yet"}</span>
          <Button size="compact" variant="ghost" disabled={acting} onclick={() => void act({ action: "check" })}>Check now</Button>
        </div>
      {/if}
      {#if error}<p role="alert" class="text-sm text-[var(--danger-foreground)]">{error}</p>{/if}
    </div>
    <CardRow label="Channel">
      <Segmented
        label="Channel"
        options={[
          { value: "stable", label: "Stable" },
          { value: "latest", label: "Latest" },
        ]}
        value={launcher.channel}
        onchange={(channel) => void act({ action: "configure", channel: channel as ReleaseChannel })}
      />
    </CardRow>
    <CardRow label="Install automatically">
      <span class="flex-1 text-xs text-muted-foreground">when nothing runs; otherwise PiSpark asks</span>
      <Toggle
        label="Install updates automatically"
        checked={launcher.autoUpdate}
        onchange={(event) => void act({ action: "configure", autoUpdate: (event.currentTarget as HTMLInputElement).checked })}
      />
    </CardRow>
  </Card>
{/if}
{#if status}
  <Card title="This PiSpark">
    <CardRow label="Version"
      ><span class="flex-1"
        >{status.version}{#if launcher}<span class="text-muted-foreground"
            >{" · "}{launcher.channel === "stable" ? "Stable" : "Latest"} channel</span
          >{/if}</span
      >{#if host.notes}<Button
          size="compact"
          variant="ghost"
          aria-expanded={showNotes}
          aria-controls="release-notes"
          onclick={() => (showNotes = !showNotes)}>What’s new</Button
        >{/if}</CardRow
    >
    {#if host.notes && showNotes}
      <div id="release-notes" class="notes" role="region" aria-label={`What’s new in ${host.notes.version}`}>
        <Markdown text={host.notes.notes} />
      </div>
    {/if}
    {#if !status.managed}<CardRow
        ><p class="text-xs text-muted-foreground">
          Started from a copy of its source (npm start or dev). Updates come from however it was started.
        </p></CardRow
      >{/if}
    <CardRow label="Data"><span class="mono">{status.data}</span></CardRow>
    <CardRow label="Address"><span class="mono">{status.address}</span></CardRow>
    {#if launcher}
      <CardRow label="Program"><span class="mono">{launcher.program}</span></CardRow>
      <CardRow label="Starts at login">{launcher.startsAtLogin ? "Yes" : "No"}</CardRow>
      <CardRow label="Logs"><span class="mono">{launcher.logs}</span></CardRow>
    {/if}
  </Card>
{/if}

<style>
  .status {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    font-size: var(--text-sm);
  }
  .status:empty {
    display: none;
  }
  .notice {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem;
    color: var(--foreground);
  }
  .mono {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
  .notice.block {
    display: block;
  }
  .notes {
    padding: 0.75rem 1rem;
  }
  /* Notes are read in a settings card, not as a reply: one size down, headings with it. */
  .notes :global(.prose) {
    font-size: var(--text-sm);
  }
  .running {
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }
  .running li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
  }
  .link {
    color: var(--interactive-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    align-self: center;
  }
  .spin {
    width: 0.75rem;
    height: 0.75rem;
    flex-shrink: 0;
    border-radius: 9999px;
    border: 2px solid var(--interactive-text);
    border-right-color: transparent;
    animation: spin 1s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
      border-right-color: var(--interactive-text);
      opacity: 0.6;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
