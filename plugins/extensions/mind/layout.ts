import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * The fixed layout of a place's `.mind/` folder, and what each file must look like. Pure rules:
 * no file access. Everything that writes into the folder is checked against these.
 *
 *   notes.md          what's true about the place: the overview, read every run
 *   notes/<topic>.md  detail, one topic per page
 *   tasks.md          waiting on you · doing · to do · done lately
 *   attachments/      files a task or a note links to
 *   skills/<name>/    steps the agent follows here (Pi skills)
 */

export const FOLDER = ".mind";
export const NOTES = "notes.md";
export const TASKS = "tasks.md";
export const NOTES_HEADINGS = ["What this is", "How it's set up", "Things to know"] as const;
export const TASK_HEADINGS = ["Waiting on you", "Doing", "To do", "Done lately"] as const;
/** The overview stays about a page; detail moves to a topic page. */
export const NOTES_LIMIT = 6_000;
export const PAGE_LIMIT = 24_000;
export const SUMMARY_LIMIT = 200;

export const LAYOUT = [
  `${FOLDER}/notes.md`,
  `${FOLDER}/notes/<topic>.md`,
  `${FOLDER}/tasks.md`,
  `${FOLDER}/attachments/<file>`,
  `${FOLDER}/skills/<name>/SKILL.md (and files beside it)`,
].join(", ");

export type Kind = "notes" | "tasks" | "page" | "attachment" | "skill" | "skill-file" | "internal" | "stray";
const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const PAGE = new RegExp(`^notes/(${NAME})\\.md$`);
const SKILL = new RegExp(`^skills/(${NAME})/SKILL\\.md$`);
const SKILL_FILE = new RegExp(`^skills/(${NAME})/.+`);

/** What a path inside the folder is. `rel` is relative to the folder, with forward slashes. */
export function kindOf(rel: string): Kind {
  if (rel === NOTES) return "notes";
  if (rel === TASKS) return "tasks";
  if (PAGE.test(rel)) return "page";
  if (/^attachments\/.+/.test(rel)) return "attachment";
  if (SKILL.test(rel)) return "skill";
  if (SKILL_FILE.test(rel)) return "skill-file";
  if (rel === ".gitignore" || rel === ".state.json" || rel.startsWith(".history/")) return "internal";
  return "stray";
}

/** Why a path may not be written by the agent, or nothing when it may. */
export function refusePath(rel: string): string | undefined {
  const kind = kindOf(rel);
  if (kind === "internal") return `${FOLDER}/${rel} is kept by the extension.`;
  if (kind !== "stray") return undefined;
  if (rel.startsWith("notes/")) return `A notes page is ${FOLDER}/notes/<topic>.md, with a lowercase, hyphenated name.`;
  if (rel.startsWith("skills/")) return `A skill is ${FOLDER}/skills/<name>/SKILL.md, with a lowercase, hyphenated name.`;
  return `${FOLDER}/${rel} is not part of the layout. The layout is: ${LAYOUT}.`;
}

const plain = (text: string) =>
  text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => plain(value).toLowerCase() === plain(b[i]!).toLowerCase());

/** A document's lines, with those inside code fences marked so headings in examples don't count. */
function lines(content: string): { text: string; code: boolean }[] {
  let code = false;
  return content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((text) => {
      const fence = /^\s*(```|~~~)/.test(text);
      const line = { text, code: code || fence };
      if (fence) code = !code;
      return line;
    });
}
const headings = (content: string) =>
  lines(content)
    .filter((l) => !l.code && /^## /.test(l.text))
    .map((l) => l.text.slice(3));

/** Why this content may not be saved as that file, or nothing when it may. */
export function check(rel: string, content: string): string | undefined {
  switch (kindOf(rel)) {
    case "notes":
      return checkNotes(content);
    case "tasks":
      return checkTasks(content);
    case "page":
      return checkPage(content);
    case "skill":
      return checkSkill(rel, content);
    default:
      return undefined;
  }
}

function checkNotes(content: string): string | undefined {
  if (!same(headings(content), NOTES_HEADINGS))
    return `${NOTES} has exactly these sections, in this order: ${NOTES_HEADINGS.map((h) => `"## ${h}"`).join(", ")}. Use ### inside a section if you need more.`;
  if (content.length > NOTES_LIMIT)
    return `${NOTES} would be ${content.length} characters; it stays under ${NOTES_LIMIT}. Move detail into a page under notes/ and leave one line pointing to it.`;
  return undefined;
}

function checkPage(content: string): string | undefined {
  const [title, summary] = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!title || !/^# \S/.test(title)) return `A notes page starts with its title: "# Title".`;
  if (!summary || summary.startsWith("#") || summary.length > SUMMARY_LIMIT)
    return `After the title, a notes page has a one-sentence summary (at most ${SUMMARY_LIMIT} characters). It is what is listed every run.`;
  if (content.length > PAGE_LIMIT) return `A notes page stays under ${PAGE_LIMIT} characters. Split it by topic.`;
  return undefined;
}

function checkSkill(rel: string, content: string): string | undefined {
  const folder = SKILL.exec(rel)![1];
  let front: Record<string, unknown>;
  try {
    front = parseFrontmatter<Record<string, unknown>>(content).frontmatter ?? {};
  } catch {
    return "SKILL.md starts with frontmatter: name and description between --- lines.";
  }
  if (front.name !== folder) return `The skill's name in its frontmatter must be its folder name: "${folder}".`;
  if (typeof front.description !== "string" || front.description.trim().length < 20)
    return "The skill's description says what it does and when to use it. It is what decides whether the skill is ever loaded.";
  return undefined;
}

const DATED = /^- \d{4}-\d{2}-\d{2}[:,] \S/;

function checkTasks(content: string): string | undefined {
  if (!same(headings(content), TASK_HEADINGS))
    return `${TASKS} has exactly these sections, in this order: ${TASK_HEADINGS.map((h) => `"## ${h}"`).join(", ")}.`;
  let section = "";
  for (const line of lines(content)) {
    if (line.code) continue;
    const text = line.text;
    if (/^## /.test(text)) {
      section = plain(text.slice(3)).toLowerCase();
      continue;
    }
    // Before the first section: a title and blank lines only. Inside one: an entry per bullet, with indented lines under it.
    if (!text.trim() || /^\s+\S/.test(text) || (!section && /^# /.test(text))) continue;
    if (!text.startsWith("- "))
      return `In ${TASKS} every item is one bullet ("- ..."), with any detail indented under it. This line is not: "${text.slice(0, 80)}"`;
    if (section === "done lately" && !DATED.test(text))
      return `Under "Done lately" each line starts with its date: "- YYYY-MM-DD: what was done or decided". This line does not: "${text.slice(0, 80)}"`;
  }
  return undefined;
}

/** The empty documents, for a place that has none yet. */
export const EMPTY_NOTES = NOTES_HEADINGS.map((h) => `## ${h}\n`).join("\n");
export const EMPTY_TASKS = TASK_HEADINGS.map((h) => `## ${h}\n`).join("\n");

/** A notes page's title and summary, as listed every run. */
export function pageHead(content: string): { title: string; summary: string } {
  const [title = "", summary = ""] = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { title: title.replace(/^#\s*/, ""), summary: summary.startsWith("#") ? "" : summary.slice(0, SUMMARY_LIMIT) };
}

/** A skill's name and description from its frontmatter. */
export function skillHead(content: string): { name: string; description: string } | undefined {
  try {
    const front = parseFrontmatter<Record<string, unknown>>(content).frontmatter ?? {};
    return typeof front.name === "string" && typeof front.description === "string"
      ? { name: front.name, description: front.description.trim() }
      : undefined;
  } catch {
    return undefined;
  }
}
