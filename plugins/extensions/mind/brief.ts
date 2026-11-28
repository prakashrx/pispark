import { existsSync } from "node:fs";
import type { Homes } from "./homes.js";
import { FOLDER, NOTES, NOTES_HEADINGS, TASK_HEADINGS, TASKS } from "./layout.js";
import { within, type Mind } from "./store.js";
import { entries, section } from "./tasks.js";

/**
 * What the agent is given at the start of every run: where things go, then the place's notes, the
 * list of its pages and its tasks. Skills are listed by Pi itself.
 */

const quoted = (headings: readonly string[]) => headings.map((h) => `"## ${h}"`).join(", ");

/** About four characters to a token: enough to see the weight, not a tokenizer. */
export const tokens = (text: string) => Math.ceil(text.length / 4);
/** Past this, the agent is asked to tidy what it keeps. Not a limit: nothing is refused. */
export const HEAVY_TOKENS = 6_000;
/** Past this, only the sections that matter now are given whole; the rest is read from the file. */
export const LARGE_TASKS = 30_000;

export interface BriefOptions {
  /** The conversation was just compacted. */
  compacted?: boolean;
  /** Another session started this one: that session keeps the tasks and talks to the person. */
  child?: boolean;
}

/** Where a lasting instruction from the person goes: the files PiSpark already loads. */
function instructions(homes: Homes, place: string): string[] {
  const shown = (file: string) => `\`${within(place, file) ?? file}\``;
  const files = (list: string[]) => list.map((file) => `${shown(file)}${existsSync(file) ? "" : " (not there yet: create it)"}`).join(" or ");
  const lines: string[] = [];
  if (homes.project) lines.push(`   - a rule for this project, for any agent: ${shown(homes.project)}`);
  if (homes.own.length) lines.push(`   - how you should work or talk with them${homes.project ? "" : ", or a rule for this place"}: your own instructions, ${files(homes.own)}`);
  if (homes.everyone.length) lines.push(`   - something every agent should do: ask first, then Default's instructions, ${files(homes.everyone)}`);
  if (!lines.length) return [`1. A lasting instruction from the person: \`${FOLDER}/${NOTES}\`, under "Things to know", marked as theirs.`];
  return [
    "1. A lasting instruction from the person goes where they would have put it themselves:",
    ...lines,
    '   If they stated it ("from now on", "always", "never"), save it at once with the smallest edit, and tell them in one line what you saved and where. If you only inferred it from a correction, ask once, yes or no. After they approve something routine, ask once whether to handle it yourself next time; a yes is saved the same way.',
  ];
}

/** The tasks as given at the start of a run. A very large file gives the current sections whole and counts the rest. */
export function tasksShown(tasks: string): string {
  if (tasks.length <= LARGE_TASKS) return tasks.trim();
  const counted = (heading: string) => {
    const n = entries(tasks).filter((e) => e.section === heading).length;
    return `## ${heading}\n(${n} ${n === 1 ? "entry" : "entries"}: read \`${FOLDER}/${TASKS}\` when you need them)`;
  };
  return [
    `## Waiting on you\n${section(tasks, "Waiting on you")}`,
    `## Doing\n${section(tasks, "Doing")}`,
    counted("To do"),
    counted("Done lately"),
  ].join("\n\n");
}

export async function brief(mind: Mind, homes: Homes, options: BriefOptions = {}): Promise<string> {
  const { compacted = false, child = false } = options;
  const [notes, tasks, pages, problems] = await Promise.all([mind.text(NOTES), mind.text(TASKS), mind.pages(), mind.problems()]);
  const out = [
    `You keep the folder \`${FOLDER}/\` in this place, so that nothing important depends on this conversation. What it holds is below. Keep it true as you work, with your ordinary file tools; a write that breaks its layout is refused with the reason.`,
    "",
    "Where things go, in this order:",
    ...instructions(homes, mind.place),
    child
      ? `2. Anything not finished: \`${FOLDER}/${TASKS}\` is kept by the session that started you. Read it, but don't edit it: say in your report what you finished, what is left and what needs the person.`
      : `2. Anything not finished: \`${FOLDER}/${TASKS}\`. Move its entry the moment it starts, needs the person, or is done. A finished entry becomes one line under "Done lately": \`- YYYY-MM-DD: what was done or decided\`. That list is for what someone picking this up later needs to know happened, not for every run.`,
    `3. Steps you follow here more than once: a skill in \`${FOLDER}/skills/\` (read the \`mind-skills\` skill first).`,
    `4. What is true about this place and will matter after this task: \`${FOLDER}/${NOTES}\`, written as how things are now. Rewrite the paragraph that changed; don't append dated entries. Don't repeat what the place's own documents or code already say: point to them, and keep what they don't say. Mark what the person told you as theirs, and don't drop it without asking. When the notes outgrow a page, move detail to \`${FOLDER}/notes/<topic>.md\` (its title, then a one-sentence summary).`,
    `5. A supporting file: \`${FOLDER}/attachments/\`, linked from a task or a note.`,
    "6. Anything else is not kept; the session has it. Never keep secrets.",
    "",
    child
      ? "Asking: you were started by another session. Put anything that needs a decision in your report to it, with what you recommend; don't ask the person directly."
      : `Asking: if the person started this run, they are here: ask in your reply. Otherwise write the question under "Waiting on you" (the question in bold, what you recommend, what you'll do meanwhile) and carry on with what you safely can; it reaches them when your run ends, and their answer comes back to you. Don't ask what the notes, the tasks or your instructions already answer.`,
    "",
    `<notes file="${FOLDER}/${NOTES}">`,
    notes?.trim() || `(Not written yet. Look around this place first, then write it with these sections: ${quoted(NOTES_HEADINGS)}. Ask the person only what you can't find out.)`,
    "</notes>",
  ];
  if (pages.length)
    out.push(`<pages folder="${FOLDER}/notes/">`, "Read a page when its topic comes up.", ...pages.map((p) => `- ${p.name}.md: ${p.title}. ${p.summary}`), "</pages>");
  out.push(
    `<tasks file="${FOLDER}/${TASKS}">`,
    (tasks?.trim() && tasksShown(tasks)) || `(Not written yet. When there is something to track, create it with these sections: ${quoted(TASK_HEADINGS)}.)`,
    "</tasks>",
  );
  if (problems.length) out.push("", `Fix in ${FOLDER}/ before anything else:`, ...problems.map((p) => `- ${p}`));
  if (compacted) out.push("", "The conversation was just compacted. Re-read the tasks above and check your next step against them before going on.");
  if (tokens(out.join("\n")) > HEAVY_TOKENS)
    out.push("", "What you keep here is getting heavy to read at the start of every run. When you get a chance, tidy it (the `mind-tidy` skill): shorten long entries, drop what no longer matters, and move detail from the notes into pages.");
  return out.join("\n");
}
