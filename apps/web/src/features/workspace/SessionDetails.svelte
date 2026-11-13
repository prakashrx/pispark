<script lang="ts">
  import Popover from "../../lib/ui/Popover.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import Icon from "../../lib/ui/Icon.svelte";
  import { useSession, useSessions } from "./session-client.svelte";
  import { describeSchedule } from "../../../../server/src/contract/cron";
  import { nextText } from "../schedules/schedule-presentation";
  import { sessionName, sessionStatus } from "./session-presentation";
  /**
   * Facts about the open chat, anchored to an info button in the chat header so the
   * conversation never moves.
   */
  let { oneditpersona, onschedules }: { oneditpersona?: () => void; onschedules?: () => void } = $props();
  const client = useSessions();
  const session = useSession();
  const snapshot = $derived(session.doc);
  const info = $derived(session.info);
  const model = $derived(snapshot?.model);
  const schedules = $derived(info ? client.schedules.of(info.id) : []);
  // The sessions this one started, with their state; one at work can be stopped from here.
  const started = $derived(info ? client.sessions.filter((each) => each.parent === info.id) : []);
  const modelName = $derived(
    client.providers.catalog.providers
      .find((p) => p.id === model?.provider)
      ?.models.find((m) => m.id === model?.id)?.name ?? model?.id,
  );
</script>

{#if info}
  <Popover label="Chat info">
    {#snippet trigger()}<Icon name="info" class="h-[18px] w-[18px]" />{/snippet}
    {#snippet children(close)}
      <section
        aria-label="Chat info"
        tabindex="-1"
        data-autofocus
        class="w-[min(19rem,80vw)] space-y-3 p-3 outline-none"
      >
        <h2 class="text-sm font-semibold">Chat info</h2>
        <dl class="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-sm">
          <dt class="text-muted-foreground">Persona</dt>
          <dd class="break-words">
            {info.persona.name}{#if info.persona.layered}<span class="text-muted-foreground"> · edited for this chat</span>{/if}
          </dd>
          <dt class="text-muted-foreground">Model</dt>
          <dd class="break-words">{modelName ?? "Not available"}</dd>
          <dt class="text-muted-foreground">Working folder</dt>
          <dd class="break-all">{info.folder}</dd>
          <dt class="text-muted-foreground">Started</dt>
          <dd>
            {new Date(info.createdAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </dd>
        </dl>
        {#if onschedules}<div class="space-y-2 border-t border-[var(--border)] pt-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-sm font-semibold">Schedules</h3>
              <Button
                size="compact"
                onclick={() => {
                  close();
                  onschedules();
                }}>{schedules.length ? "Manage" : "Add"}</Button
              >
            </div>
            {#if schedules.length}<ul class="space-y-1.5 text-sm">
                {#each schedules.slice(0, 4) as schedule (schedule.id)}<li class="flex items-start gap-2">
                    <Icon name="clock" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span
                      >{describeSchedule(schedule)}<span class="block text-xs text-muted-foreground"
                        >{nextText(schedule, client.schedules.paused)}</span
                      ></span
                    >
                  </li>{/each}
              </ul>{:else}<p class="text-xs text-muted-foreground">Send a prompt to this chat at a time, once or repeating.</p>{/if}
          </div>{/if}
        {#if started.length}<div class="space-y-2 border-t border-[var(--border)] pt-3">
            <h3 class="text-sm font-semibold">Sessions it started</h3>
            <ul class="space-y-1.5 text-sm" aria-label="Sessions it started">
              {#each started as child (child.id)}
                {@const state = sessionStatus(child)}
                <li class="flex items-center gap-2">
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-[var(--interactive-text)] underline underline-offset-2"
                    onclick={() => {
                      close();
                      client.select(child.id);
                    }}>{sessionName(child)}</button
                  >
                  <span class="text-xs text-muted-foreground">{state || "Finished"}</span>
                  {#if state === "Working…" || state === "Queued"}<Button size="compact" variant="ghost" onclick={() => void client.stop(child.id)}
                      >Stop<span class="sr-only"> {sessionName(child)}</span></Button
                    >{/if}
                </li>
              {/each}
            </ul>
            <p class="text-xs text-muted-foreground">Each reports back here when it finishes.</p>
          </div>{/if}
        {#if snapshot && oneditpersona}<div
            class="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3"
          >
            <p class="text-xs text-muted-foreground">
              Add or turn off skills, tools and instructions for this chat only.
            </p>
            <Button
              size="compact"
              class="shrink-0 whitespace-nowrap"
              onclick={() => {
                close();
                oneditpersona();
              }}>Edit persona</Button
            >
          </div>{/if}
      </section>
    {/snippet}
  </Popover>
{/if}
