import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { brief } from "./brief.js";
import { findHomes, homeOf, type Homes, select } from "./homes.js";
import { check, FOLDER, NOTES, refusePath, TASKS } from "./layout.js";
import { Mind } from "./store.js";
import { questions, section, spoken, withAnswer } from "./tasks.js";

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
const SCHEDULE_REQUEST = "pispark:schedule-request";
const AS_RECOMMENDED = "Do as recommended";
const NO = "No, don't";
const OWN_WORDS = "Answer in my own words";

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
  const edits = Array.isArray(input.edits) ? input.edits : input.oldText !== undefined ? [{ oldText: input.oldText, newText: input.newText }] : [];
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
  let run = { worked: false, kept: false, reminded: false, said: undefined as string | undefined };
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
    if (!ours) run = { worked: false, kept: false, reminded: false, said: event.messageType === "user" ? event.prompt : undefined };
    homes = findHomes(pi, ctx, event.systemPromptOptions.contextFiles);
    event.systemPromptOptions.sections.mind = await brief(mindOf(ctx), homes, compacted);
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
      if ((event.toolName !== "bash" && event.toolName !== "powershell") || typeof command !== "string" || !command.includes(FOLDER) || !m.exists()) return undefined;
      const problems = await m.problems();
      await show(ctx);
      return problems.length ? { content: [...event.content, { type: "text" as const, text: `\n${FOLDER}/ is out of shape. Fix it now:\n${problems.map((p) => `- ${p}`).join("\n")}` }] } : undefined;
    }
    if (event.isError) return undefined;
    const after = await readText(change.file);
    if (after === change.before) return undefined;
    // An edit that could not be previewed is checked here, and put back if it broke the document.
    const reason = change.rel && after !== undefined ? check(change.rel, after) : undefined;
    if (reason) {
      if (change.before === undefined) await rm(change.file, { force: true });
      else await writeFile(change.file, change.before, "utf8");
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
      return remind(CHECKPOINT, `The conversation will soon be compacted and its older details summarised. Bring \`${FOLDER}/${TASKS}\` up to date now: where each thing you are doing stands, its next step, and any constraint or decision from this conversation that isn't written down yet. Then end your turn without saying anything more.`);
    }
    if (run.reminded || run.kept || !(run.worked || (run.said && LASTING.test(run.said)))) return undefined;
    run.reminded = true;
    const notes = (await m.text(NOTES)) === undefined ? ` This place has no \`${FOLDER}/${NOTES}\` yet: write it if you now know enough to.` : "";
    return remind(REMINDER, `Before you finish, bring \`${FOLDER}/\` up to date for this run: move the entries in \`${FOLDER}/${TASKS}\` that changed (something important you did or decided becomes a dated line under "Done lately"), and fix any note that is no longer true.${notes} If the person's last message carried a lasting instruction or a correction, save it where it belongs. Write only what someone picking this up later would need: never a line that only says nothing changed. If nothing needs changing, write nothing and end your turn without saying anything more.`);
  });

  // ---- After a run: clean up, then take new questions to the person ------------------------------

  pi.on("agent_settled", (event, ctx) => {
    if (event.aborted) return;
    void (async () => {
      try {
        await mindOf(ctx).sweep();
        await show(ctx);
        await ask(ctx);
      } catch {
        // Nothing here may disturb the session; the documents stay as the agent left them.
      }
    })();
  });

  /** Shows each new question under "Waiting on you" once; the run has already ended. */
  async function ask(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;
    const m = mindOf(ctx);
    const open = questions((await m.text(TASKS)) ?? "").filter((q) => q.answer === undefined);
    const fresh = new Set(await m.markAsked(open.map((q) => q.id)));
    for (const question of open.filter((q) => fresh.has(q.id))) {
      const stop = new AbortController();
      asking.set(question.id, stop);
      try {
        // The card shows the whole entry: the question first, then what is recommended and what happens meanwhile.
        const choice = await ctx.ui.select(spoken([question.text, question.detail].filter(Boolean).join(" ")), [AS_RECOMMENDED, NO, OWN_WORDS], { signal: stop.signal });
        const answer =
          choice === AS_RECOMMENDED ? "Yes, do as you recommend."
          : choice === NO ? "No, don't."
          : choice === OWN_WORDS ? (await ctx.ui.input("Your answer", "", { signal: stop.signal }))?.trim()
          : undefined;
        if (answer && !stop.signal.aborted) await answerQuestion(ctx, question.id, answer);
      } catch {
        // Closed, or answered elsewhere: it stays under "Waiting on you" and in the view.
      } finally {
        asking.delete(question.id);
      }
    }
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
    const message = `My answer to "${spoken(question.text)}" (under "Waiting on you" in ${FOLDER}/${TASKS}): ${answer}\n\nAct on it and update the entry.`;
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
      const open = new Set(questions(tasks).filter((q) => q.answer === undefined).map((q) => q.id));
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
            const message = { request: { action: "add", input: { cron: WEEKLY, prompt: TIDY, run: "new", report: "status" } }, reply: (answer: { text: string }) => done(answer.text), taken: false };
            pi.events.emit(SCHEDULE_REQUEST, message);
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
      ctx.ui.notify(m.exists() ? `${waiting} waiting on you. The Mind view shows the rest.` : `Nothing is kept for this place yet.`, "info");
    },
  });
}
