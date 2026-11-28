import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { brief, tokens } from "./brief.js";
import { findHomes, homeOf, type Homes, select } from "./homes.js";
import { check, FOLDER, NOTES, refusePath, TASKS } from "./layout.js";
import { Mind, write } from "./store.js";
import { headline, questions, section, spoken, withAnswer } from "./tasks.js";

/**
 * mind: what an agent keeps for itself in the place it works in, so that the person never repeats
 * themselves and the agent can carry its own work across sessions and unattended runs.
 *
 * The agent writes plain documents in `.mind/` with its ordinary file tools. This extension puts
 * them in front of it every run, checks every write against the fixed layout, keeps earlier
 * versions, reminds it at the end of a run and before a compaction, takes its questions to the
 * person without stopping the run, and shows it all in a view. See README.md.
 */

/** Tools that change nothing worth keeping track of. */
const QUIET = new Set(["read", "grep", "find", "ls", "tool_search", "pispark_set_title"]);
const REMINDER = "mind-reminder";
const CHECKPOINT = "mind-checkpoint";
/** PiSpark's bus channel for what a session says to it: here, the verb that schedules. */
const VERB = "pispark:verb";
/** PiSpark marks a run that something other than the person started with this entry before its message. */
const WOKEN = "pispark:woken";
/** The answers a question card offers. */
const DO_IT = "Do it";
const NO = "No";
const LATER = "Later";
const DISCUSS = "Discuss in the conversation";
/** A question put off (Later, Discuss, skipped, or asked while the person was here) waits this long before it is put to them again. */
const LATER_MS = 20 * 3_600_000;

/** Words that mark a lasting instruction. Kept narrow: a false match costs the person a needless extra turn. */
const LASTING = /\b(from now on|always|never|next time|every time|each time|in future|going forward|remember (to|that)|i told you)\b/i;

const TIDY = `Tidy this place's ${FOLDER}/, using the mind-tidy skill. Report in at most three lines, and only what needs me.`;
const WEEKLY = "0 9 * * 1";

const readText = (file: string) => readFile(file, "utf8").catch(() => undefined);
/** Today in the server's own time zone, as the agent writes its dates. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** What an `edit` would leave in the file, when its replacements can be applied exactly; else nothing. */
export function edited(before: string | undefined, input: Record<string, unknown>): string | undefined {
  if (before === undefined) return undefined;
  const edits = Array.isArray(input.edits)
    ? input.edits
    : input.oldText !== undefined
      ? [{ oldText: input.oldText, newText: input.newText }]
      : [];
  const spots: { at: number; oldText: string; newText: string }[] = [];
  for (const each of edits as { oldText?: unknown; newText?: unknown }[]) {
    if (typeof each?.oldText !== "string" || typeof each.newText !== "string" || !each.oldText) return undefined;
    const at = before.indexOf(each.oldText);
    if (at < 0 || before.indexOf(each.oldText, at + 1) >= 0) return undefined;
    spots.push({ at, oldText: each.oldText, newText: each.newText });
  }
  if (!spots.length) return undefined;
  spots.sort((a, b) => a.at - b.at);
  let out = "";
  let from = 0;
  for (const spot of spots) {
    if (spot.at < from) return undefined;
    out += before.slice(from, spot.at) + spot.newText;
    from = spot.at + spot.oldText.length;
  }
  return out + before.slice(from);
}

type Entry = { type: string; customType?: string; data?: unknown; message?: { role?: string } };
const woken = (entry: Entry | undefined) => entry?.type === "custom" && entry.customType === WOKEN;

/** Whether the person started this run: their own message, not a wake (a schedule, a child's report, a process). */
export function startedByPerson(messageType: string, branch: readonly Entry[]): boolean {
  return messageType === "user" && !branch.slice(-2).some(woken);
}

/** Whether another session started this one: its first message came from a session. */
export function startedBySession(branch: readonly Entry[]): boolean {
  const first = branch.findIndex((entry) => entry.type === "message" && entry.message?.role === "user");
  // Before its first message is kept, the wake that brings it is the newest entry.
  const marker = first < 0 ? branch.at(-1) : branch[first - 1];
  return woken(marker) && (marker!.data as { source?: { kind?: string } } | undefined)?.source?.kind === "session";
}

/** Close to PiSpark's compaction point: 70% of the usable window (the model's, or where its price rises). */
function nearCompaction(ctx: ExtensionContext): boolean {
  const usage = ctx.getContextUsage();
  if (!usage?.tokens) return false;
  const tiers = (ctx.model?.cost as { tiers?: { inputTokensAbove: number }[] } | undefined)?.tiers ?? [];
  return usage.tokens >= Math.min(usage.contextWindow, ...tiers.map((t) => t.inputTokensAbove)) * 0.55;
}

export default function mind(pi: ExtensionAPI) {
  let place: Mind | undefined;
  let homes: Homes | undefined;
  /** What this run did: other work, writes to what it keeps, whether it was already reminded, and what the person said. */
  let run = { worked: false, kept: false, reminded: false, byPerson: false, said: undefined as string | undefined };
  /** Another session started this one: it keeps the tasks and talks to the person. */
  let child = false;
  let checkpointed = false;
  let compacted = false;
  /** A file a running `write` or `edit` is about to change, and what it held before. */
  const pending = new Map<string, { file: string; rel?: string; label: string; agent?: boolean; before: string | undefined }>();
  /** Questions now shown to the person, so an answer given elsewhere closes the card. */
  const asking = new Map<string, AbortController>();

  const mindOf = (ctx: ExtensionContext) => (place && place.place === ctx.cwd ? place : (place = new Mind(ctx.cwd)));

  // ---- Every run starts from what is kept ------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    const m = mindOf(ctx);
    await m.sweep();
    await show(ctx);
  });

  // The place's own skills, loaded by Pi (and again on reload).
  pi.on("resources_discover", (event) => ({ skillPaths: [join(event.cwd, FOLDER, "skills")] }));

  pi.on("before_agent_start", async (event, ctx) => {
    // A reminder of ours continues the person's run; anything else starts a new one.
    const ours = event.messageType === "custom" && (event.message.customType === REMINDER || event.message.customType === CHECKPOINT);
    const branch = ctx.sessionManager.getBranch() as readonly Entry[];
    if (!ours) {
      const byPerson = startedByPerson(event.messageType, branch);
      run = {
        worked: false,
        kept: false,
        reminded: false,
        byPerson,
        said: byPerson && event.messageType === "user" ? event.prompt : undefined,
      };
    }
    child ||= startedBySession(branch);
    homes = findHomes(pi, ctx, event.systemPromptOptions.contextFiles);
    event.systemPromptOptions.sections.mind = await brief(mindOf(ctx), homes, { compacted, child });
    compacted = false;
  });

  pi.on("session_compact", () => {
    compacted = true;
    checkpointed = false;
  });

  // ---- Every write is checked -----------------------------------------------------------------

  pi.on("tool_call", async (event, ctx) => {
    const input = event.input as Record<string, unknown>;
    if ((event.toolName !== "write" && event.toolName !== "edit") || typeof input.path !== "string") {
      if (!QUIET.has(event.toolName)) run.worked = true;
      return undefined;
    }
    const m = mindOf(ctx);
    const file = resolve(ctx.cwd, input.path.replace(/^@/, ""));
    const rel = m.rel(file);
    if (rel === undefined) {
      // One of the person's own instruction files: not checked, but its earlier version is kept.
      const home = homeOf(homes, ctx.cwd, file);
      if (home) pending.set(event.toolCallId, { file, ...home, before: await readText(file) });
      else run.worked = true;
      return undefined;
    }
    const refused = refusePath(rel);
    if (refused) return { block: true, reason: `Not saved. ${refused}` };
    if (child && rel === TASKS)
      return {
        block: true,
        reason: `Not saved. \`${FOLDER}/${TASKS}\` is kept by the session that started you: put this in your report to it instead.`,
      };
    const before = await readText(file);
    const after = event.toolName === "write" ? (typeof input.content === "string" ? input.content : undefined) : edited(before, input);
    const reason = after === undefined ? undefined : check(rel, after);
    if (reason) return { block: true, reason: `Not saved. ${reason}` };
    pending.set(event.toolCallId, { file, rel, label: `${FOLDER}/${rel}`, before });
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const m = mindOf(ctx);
    const change = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (!change) {
      // A shell command may have put files in the folder: say what is out of place.
      const command = (event.input as { command?: unknown }).command;
      if (
        (event.toolName !== "bash" && event.toolName !== "powershell") ||
        typeof command !== "string" ||
        !command.includes(FOLDER) ||
        !m.exists()
      )
        return undefined;
      const problems = await m.problems();
      await show(ctx);
      return problems.length
        ? {
            content: [
              ...event.content,
              { type: "text" as const, text: `\n${FOLDER}/ is out of shape. Fix it now:\n${problems.map((p) => `- ${p}`).join("\n")}` },
            ],
          }
        : undefined;
    }
    if (event.isError) return undefined;
    const after = await readText(change.file);
    if (after === change.before) return undefined;
    // An edit that could not be previewed is checked here, and put back if it broke the document.
    const reason = change.rel && after !== undefined ? check(change.rel, after) : undefined;
    if (reason) {
      if (change.before === undefined) await rm(change.file, { force: true });
      else await write(change.file, change.before);
      return { content: [{ type: "text" as const, text: `Not saved: the file was put back as it was. ${reason}` }], isError: true };
    }
    await m.keep(change.file, change.before, change.label);
    run.kept = true;
    if (change.rel === TASKS) await m.sweep();
    if (change.agent) await select(change.file);
    await show(ctx);
    return undefined;
  });

  // ---- Reminders: before the context is compacted, and at the end of a run ------------------------

  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed") return undefined;
    const m = mindOf(ctx);
    const remind = (customType: string, content: string) => ({
      entries: [...event.entries, { type: "custom_message" as const, customType, content, display: false }],
      continue: true,
    });
    if (!checkpointed && nearCompaction(ctx) && section((await m.text(TASKS)) ?? "", "Doing")) {
      checkpointed = true;
      return remind(
        CHECKPOINT,
        `The conversation will soon be compacted and its older details summarised. Bring \`${FOLDER}/${TASKS}\` up to date now: where each thing you are doing stands, its next step, and any constraint or decision from this conversation that isn't written down yet. Then end your turn without saying anything more.`,
      );
    }
    if (run.reminded || run.kept || !(run.worked || (run.said && LASTING.test(run.said)))) return undefined;
    run.reminded = true;
    if (child)
      return remind(
        REMINDER,
        `Before you finish: if you learned something true about this place that will matter later, add it to \`${FOLDER}/${NOTES}\`, and fix a skill you used if it was wrong. Leave \`${FOLDER}/${TASKS}\` to the session that started you, and say in your report what changed. If nothing needs changing, end your turn without saying anything more.`,
      );
    const notes =
      (await m.text(NOTES)) === undefined ? ` This place has no \`${FOLDER}/${NOTES}\` yet: write it if you now know enough to.` : "";
    return remind(
      REMINDER,
      `Before you finish, bring \`${FOLDER}/\` up to date for this run: move the entries in \`${FOLDER}/${TASKS}\` that changed (something important you did or decided becomes a dated line under "Done lately"), and fix any note that is no longer true.${notes} If the person's last message carried a lasting instruction or a correction, save it where it belongs. Write only what someone picking this up later would need: never a line that only says nothing changed. If nothing needs changing, write nothing and end your turn without saying anything more.`,
    );
  });

  // ---- After a run: clean up, then take new questions to the person ------------------------------

  pi.on("agent_settled", (event, ctx) => {
    if (event.aborted) return;
    const byPerson = run.byPerson;
    void (async () => {
      try {
        await mindOf(ctx).sweep();
        await show(ctx);
        await ask(ctx, byPerson);
      } catch {
        // Nothing here may disturb the session; the documents stay as the agent left them.
      }
    })();
  });

  /**
   * After a run, the questions under "Waiting on you" that are due. A run the person started asked
   * them in its reply, so they are only put off. A run nobody watched puts each due question to the
   * person as a card (which also reaches their phone). Another session's worker asks nobody.
   */
  async function ask(ctx: ExtensionContext, byPerson: boolean): Promise<void> {
    if (!ctx.hasUI || child) return;
    const m = mindOf(ctx);
    const open = questions((await m.text(TASKS)) ?? "").filter((q) => q.answer === undefined);
    if (!open.length) return;
    if (byPerson) {
      const { asked } = await m.questionState();
      await m.defer(
        open.filter((q) => !asked[q.id]).map((q) => q.id),
        Date.now() + LATER_MS,
      );
      return;
    }
    const due = new Set(await m.takeDue(open.map((q) => q.id)));
    for (const question of open.filter((q) => due.has(q.id))) {
      const stop = new AbortController();
      asking.set(question.id, stop);
      let choice: string | undefined;
      try {
        // The card shows the whole entry: the question first, then what is recommended and what happens meanwhile.
        choice = await ctx.ui.select(spoken([question.text, question.detail].filter(Boolean).join(" ")), [DO_IT, NO, LATER, DISCUSS], {
          signal: stop.signal,
        });
      } catch {
        choice = undefined;
      } finally {
        asking.delete(question.id);
      }
      // Answered in the view meanwhile: nothing more to do.
      if (stop.signal.aborted) continue;
      try {
        if (choice === DO_IT) await answerQuestion(ctx, question.id, "Yes, do as you recommend.");
        else if (choice === NO) await answerQuestion(ctx, question.id, "No, don't.");
        else {
          // Later, Discuss or skipped: it keeps waiting and is put to them once more later.
          await putOff(ctx, question.id);
          if (choice === DISCUSS) ctx.ui.setEditorText(`About "${headline(question.text)}": `);
        }
      } catch {
        // The question changed meanwhile; it stays in the view.
      }
    }
  }

  /** Keeps a question waiting without putting it to the person again for a while. */
  async function putOff(ctx: ExtensionContext, id: string): Promise<void> {
    await mindOf(ctx).defer([id], Date.now() + LATER_MS);
    asking.get(id)?.abort();
    await show(ctx);
  }

  /** Writes the person's answer under the question and gives it to the agent to act on. */
  async function answerQuestion(ctx: ExtensionContext, id: string, answer: string): Promise<void> {
    const m = mindOf(ctx);
    const content = (await m.text(TASKS)) ?? "";
    const question = questions(content).find((q) => q.id === id);
    if (!question) throw new Error("That question is no longer waiting.");
    if (question.answer !== undefined) throw new Error("That question was already answered.");
    const next = withAnswer(content, id, answer, today())!;
    await m.save(TASKS, next);
    asking.get(id)?.abort();
    await show(ctx);
    const message = `My answer to "${spoken(question.text)}" (under "Waiting on you" in ${FOLDER}/${TASKS}): ${answer}\n\nIf that settles it, act on it and update the entry. If I'm putting it off or want to talk it over first, don't act yet: keep it waiting.`;
    void pi.sendUserMessage(message, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
  }

  // ---- The view ---------------------------------------------------------------------------------

  /** Offers the Mind view beside the conversation, with what is kept now. */
  async function show(ctx: ExtensionContext, attention = false): Promise<void> {
    const m = mindOf(ctx);
    let snapshot;
    try {
      const tasks = (await m.text(TASKS)) ?? "";
      // A card for a question that was answered elsewhere, or is gone, closes.
      const open = new Set(
        questions(tasks)
          .filter((q) => q.answer === undefined)
          .map((q) => q.id),
      );
      for (const [id, stop] of asking) if (!open.has(id)) stop.abort();
      snapshot = {
        waiting: questions(tasks),
        doing: section(tasks, "Doing"),
        todo: section(tasks, "To do"),
        done: section(tasks, "Done lately"),
        notes: (await m.text(NOTES)) ?? "",
        pages: await m.pages(),
        skills: await m.skills(),
        changes: await m.changes(),
        problems: await m.problems(),
        weight: tokens(await brief(m, homes ?? { own: [], everyone: [] }, { child })),
      };
    } catch {
      return;
    }
    const text = (value: unknown, max: number) => {
      if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("That can't be used.");
      return value.trim();
    };
    pi.events.emit("pispark:view", {
      point: "session.view",
      key: "mind",
      title: "Mind",
      component: new URL("./Mind.svelte", import.meta.url),
      props: { snapshot },
      ...(attention ? { attention: true } : {}),
      calls: {
        answer: async (data: { id?: unknown; text?: unknown }) => answerQuestion(ctx, text(data?.id, 16), text(data?.text, 2000)),
        later: async (data: { id?: unknown }) => putOff(ctx, text(data?.id, 16)),
        undo: async (data: { id?: unknown }) => {
          const label = await m.undo(text(data?.id, 80));
          await show(ctx);
          return label;
        },
        page: async (data: { name?: unknown }) => {
          const name = text(data?.name, 80);
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error("No such page.");
          return (await m.text(`notes/${name}.md`)) ?? "";
        },
        tidy: () => void pi.sendUserMessage(TIDY, ctx.isIdle() ? undefined : { deliverAs: "followUp" }),
        weekly: () =>
          new Promise<string>((done) => {
            const message = {
              request: { verb: "schedule", cron: WEEKLY, prompt: TIDY, run: "new" },
              reply: (answer: { text: string }) => done(answer.text),
              taken: false,
            };
            pi.events.emit(VERB, message);
            if (!message.taken) done("Schedules are not available here.");
          }),
      },
    });
  }

  pi.registerCommand("mind", {
    description: `What this agent keeps for this place (${FOLDER}/): opens the Mind view. /mind tidy tidies it now.`,
    handler: async (args, ctx) => {
      if (args.trim() === "tidy") return void pi.sendUserMessage(TIDY);
      await show(ctx, true);
      const m = mindOf(ctx);
      const waiting = questions((await m.text(TASKS)) ?? "").filter((q) => q.answer === undefined).length;
      ctx.ui.notify(
        m.exists() ? `${waiting} waiting on you. The Mind view shows the rest.` : `Nothing is kept for this place yet.`,
        "info",
      );
    },
  });
}
