import { existsSync } from "node:fs";
import { relative } from "node:path";
import type { Homes } from "./homes.js";
import { FOLDER, NOTES, NOTES_HEADINGS, TASK_HEADINGS, TASKS } from "./layout.js";
import type { Mind } from "./store.js";

/**
 * What the agent is given at the start of every run: where things go, then the place's notes, the
 * list of its pages and its tasks. Skills are listed by Pi itself.
 */

const quoted = (headings: readonly string[]) => headings.map((h) => `"## ${h}"`).join(", ");

/** Where a lasting instruction from the person goes: the files PiSpark already loads. */
function instructions(homes: Homes, place: string): string[] {
  const shown = (file: string) => {
    const rel = relative(place, file);
    return `\`${rel && !rel.startsWith("..") && !/^[A-Za-z]:/.test(rel) ? rel.replaceAll("\\", "/") : file}\``;
  };
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

export async function brief(mind: Mind, homes: Homes, compacted: boolean): Promise<string> {
  const [notes, tasks, pages, problems] = await Promise.all([mind.text(NOTES), mind.text(TASKS), mind.pages(), mind.problems()]);
  const out = [
    `You keep the folder \`${FOLDER}/\` in this place, so that nothing important depends on this conversation. What it holds is below. Keep it true as you work, with your ordinary file tools; a write that breaks its layout is refused with the reason.`,
    "",
    "Where things go, in this order:",
    ...instructions(homes, mind.place),
    `2. Anything not finished: \`${FOLDER}/${TASKS}\`. Move its entry the moment it starts, needs the person, or is done. A finished entry becomes one line under "Done lately": \`- YYYY-MM-DD: what was done or decided\`. That list is for what someone picking this up later needs to know happened, not for every run.`,
    `3. Steps you follow here more than once: a skill in \`${FOLDER}/skills/\` (read the \`mind-skills\` skill first).`,
    `4. What is true about this place and will matter after this task: \`${FOLDER}/${NOTES}\`, written as how things are now. Rewrite the paragraph that changed; don't append dated entries. Don't repeat what the place's own documents or code already say: point to them, and keep what they don't say. Mark what the person told you as theirs, and don't drop it without asking. When the notes outgrow a page, move detail to \`${FOLDER}/notes/<topic>.md\` (its title, then a one-sentence summary).`,
    `5. A supporting file: \`${FOLDER}/attachments/\`, linked from a task or a note.`,
    "6. Anything else is not kept; the session has it. Never keep secrets.",
    "",
    `Asking: if the person is here and you can't go on without their answer, ask in your reply. Otherwise write the question under "Waiting on you" (the question in bold, what you recommend, what you'll do meanwhile) and carry on with what you safely can. It reaches them when your run ends, and their answer comes back to you. Don't ask what the notes, the tasks or your instructions already answer.`,
    "",
    `<notes file="${FOLDER}/${NOTES}">`,
    notes?.trim() || `(Not written yet. Look around this place first, then write it with these sections: ${quoted(NOTES_HEADINGS)}. Ask the person only what you can't find out.)`,
    "</notes>",
  ];
  if (pages.length)
    out.push(`<pages folder="${FOLDER}/notes/">`, "Read a page when its topic comes up.", ...pages.map((p) => `- ${p.name}.md: ${p.title}. ${p.summary}`), "</pages>");
  out.push(
    `<tasks file="${FOLDER}/${TASKS}">`,
    tasks?.trim() || `(Not written yet. When there is something to track, create it with these sections: ${quoted(TASK_HEADINGS)}.)`,
    "</tasks>",
  );
  if (problems.length) out.push("", `Fix in ${FOLDER}/ before anything else:`, ...problems.map((p) => `- ${p}`));
  if (compacted) out.push("", `The conversation was just compacted. Re-read the tasks above and check your next step against them before going on.`);
  return out.join("\n");
}
