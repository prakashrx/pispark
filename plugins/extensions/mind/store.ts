import { randomUUID } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { check, FOLDER, kindOf, NOTES, pageHead, skillHead, TASKS } from "./layout.js";
import { questions, trimDone } from "./tasks.js";

/**
 * A place's `.mind/` folder on disk: reading it, the extension's own few writes, the earlier
 * versions kept so any change can be undone, and the mechanical cleaning. The agent writes its
 * documents with its ordinary file tools; `index.ts` checks those writes against `layout.ts`.
 */

/** "Done lately" keeps this many lines. */
export const DONE_KEPT = 30;
/** An attachment nothing links to is removed after this long. */
export const UNLINKED_DAYS = 7;
/** Earlier versions kept, newest first, across all files. */
export const HISTORY_KEPT = 200;

/** When each waiting question was first put to the person, and until when it is put off. */
export interface QuestionState {
  asked: Record<string, string>;
  later: Record<string, string>;
}

export interface Change {
  id: string;
  /** The file as the person would name it: ".mind/notes.md", "AGENTS.md", "Instructions: Role.md". */
  label: string;
  at: string;
  /** The change created the file; undoing it removes the file. */
  created: boolean;
}
interface Version extends Change {
  file: string;
  before: string | null;
}

/**
 * One spelling for one file: its real path, through links and Windows short names. For a file
 * that isn't there yet, its nearest existing folder's real path and then its name.
 */
export function canonical(path: string): string {
  const full = resolve(path);
  let real: string;
  try {
    real = realpathSync.native(full);
  } catch {
    const parent = dirname(full);
    real = parent === full ? full : join(canonical(parent), basename(full));
  }
  return real;
}

/**
 * Where a path is inside a folder, with forward slashes; nothing when it is outside (or is the folder). A name
 * that only starts with two dots (`..notes`) is inside. Case is ignored on Windows, as Node's `relative` does there.
 */
export function within(dir: string, path: string): string | undefined {
  const rel = relative(canonical(dir), canonical(path));
  return !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? undefined : rel.split(sep).join("/");
}

/**
 * Replaces a file whole. On Windows a rename fails while another reader (an indexer, a virus
 * scanner) has the file open for a moment, so it is tried again for up to about four seconds.
 */
export async function write(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID().slice(0, 6)}.tmp`;
  await writeFile(temporary, content, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(temporary, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 20 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        await rm(temporary, { force: true });
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(250, 25 * (attempt + 1))));
    }
  }
}
const readText = (file: string) => readFile(file, "utf8").catch(() => undefined);

export class Mind {
  readonly dir: string;
  constructor(readonly place: string) {
    this.dir = join(place, FOLDER);
  }

  exists(): boolean {
    return existsSync(this.dir);
  }
  /** A path's place inside the folder, with forward slashes; nothing when it is outside. */
  rel(file: string): string | undefined {
    return within(this.dir, file);
  }
  text(rel: string): Promise<string | undefined> {
    return readText(join(this.dir, rel));
  }

  /** Every file in the folder, as paths relative to it, without the extension's own. */
  private async files(under = ""): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(join(this.dir, under), { withFileTypes: true }).catch(() => [])) {
      const rel = under ? `${under}/${entry.name}` : entry.name;
      if (kindOf(rel) === "internal" || rel === ".history" || entry.name.endsWith(".tmp")) continue;
      if (entry.isDirectory()) found.push(...(await this.files(rel)));
      else found.push(rel);
    }
    return found;
  }

  async pages(): Promise<{ name: string; title: string; summary: string }[]> {
    const pages = [];
    for (const rel of (await this.files("notes")).filter((each) => kindOf(each) === "page").sort())
      pages.push({ name: rel.slice("notes/".length, -".md".length), ...pageHead((await this.text(rel)) ?? "") });
    return pages;
  }

  async skills(): Promise<{ name: string; description: string }[]> {
    const skills = [];
    for (const rel of (await this.files("skills")).filter((each) => kindOf(each) === "skill").sort()) {
      const head = skillHead((await this.text(rel)) ?? "");
      if (head) skills.push(head);
    }
    return skills;
  }

  /** What breaks the layout now: files that don't belong, and documents out of shape. */
  async problems(): Promise<string[]> {
    const found: string[] = [];
    for (const rel of await this.files()) {
      const kind = kindOf(rel);
      if (kind === "stray")
        found.push(`${FOLDER}/${rel} is not part of the layout: move it to ${FOLDER}/attachments/ or out of ${FOLDER}.`);
      else if (kind === "notes" || kind === "tasks" || kind === "page" || kind === "skill") {
        const reason = check(rel, (await this.text(rel)) ?? "");
        if (reason) found.push(`${FOLDER}/${rel}: ${reason}`);
      }
    }
    return found;
  }

  // ---- Earlier versions ---------------------------------------------------------------------

  private get history(): string {
    return join(this.dir, ".history");
  }

  /** Keeps what a file held before a change (nothing: the change created it). */
  async keep(file: string, before: string | undefined, label: string): Promise<void> {
    const at = new Date().toISOString();
    const id = `${at.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 4)}`;
    const version: Version = { id, file, label, at, created: before === undefined, before: before ?? null };
    await write(join(this.history, `${id}.json`), JSON.stringify(version));
    await this.ignore();
  }

  private async versions(): Promise<string[]> {
    return (await readdir(this.history).catch(() => []))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .reverse();
  }

  /** The latest changes, newest first. */
  async changes(limit = 20): Promise<Change[]> {
    const changes: Change[] = [];
    for (const name of (await this.versions()).slice(0, limit)) {
      try {
        const { id, label, at, created } = JSON.parse(await readFile(join(this.history, name), "utf8")) as Version;
        changes.push({ id, label, at, created });
      } catch {
        // An unreadable version is skipped; the others still show.
      }
    }
    return changes;
  }

  /** Puts a file back as it was before that change. The undo is itself kept, so it can be undone. */
  async undo(id: string): Promise<string> {
    if (!/^[\w-]+$/.test(id)) throw new Error("No such change.");
    const version = await readFile(join(this.history, `${id}.json`), "utf8").then(
      (text) => JSON.parse(text) as Version,
      () => undefined,
    );
    if (!version) throw new Error("No such change.");
    await withFileMutationQueue(version.file, async () => {
      await this.keep(version.file, await readText(version.file), version.label);
      if (version.before === null) await rm(version.file, { force: true });
      else await write(version.file, version.before);
    });
    return version.label;
  }

  /** The extension's own write of a document: checked like any other, with the earlier version kept. */
  async save(rel: string, content: string): Promise<void> {
    const reason = check(rel, content);
    if (reason) throw new Error(reason);
    const file = join(this.dir, rel);
    await withFileMutationQueue(file, async () => {
      await this.keep(file, await readText(file), `${FOLDER}/${rel}`);
      await write(file, content);
    });
  }

  /** The folder ignores itself in git: it is the agent's, not the project's. */
  async ignore(): Promise<void> {
    const file = join(this.dir, ".gitignore");
    if (this.exists() && !existsSync(file))
      await writeFile(file, "# The agent's own folder for this place (PiSpark mind). Remove this file to track it.\n*\n", "utf8");
  }

  // ---- When each question was put to the person, and when it may be again -------------------

  private get stateFile(): string {
    return join(this.dir, ".state.json");
  }
  async questionState(): Promise<QuestionState> {
    try {
      const state = JSON.parse(await readFile(this.stateFile, "utf8")) as Partial<QuestionState>;
      return { asked: state.asked ?? {}, later: state.later ?? {} };
    } catch {
      return { asked: {}, later: {} };
    }
  }
  private async changeState(change: (state: QuestionState) => boolean): Promise<void> {
    await withFileMutationQueue(this.stateFile, async () => {
      const state = await this.questionState();
      if (change(state)) await write(this.stateFile, JSON.stringify(state, null, 2) + "\n");
    });
  }
  /**
   * Of these questions, the ones to put to the person now: never put to them before, or put off
   * until a time that has passed. They are marked as put to them.
   */
  async takeDue(ids: string[], now = Date.now()): Promise<string[]> {
    let due: string[] = [];
    await this.changeState((state) => {
      due = ids.filter((id) => !state.asked[id] || (state.later[id] !== undefined && Date.parse(state.later[id]!) <= now));
      for (const id of due) {
        state.asked[id] = new Date(now).toISOString();
        delete state.later[id];
      }
      return due.length > 0;
    });
    return due;
  }
  /** Puts questions off: they are not put to the person again before `until`. */
  async defer(ids: string[], until: number, now = Date.now()): Promise<void> {
    if (!ids.length) return;
    await this.changeState((state) => {
      for (const id of ids) {
        state.asked[id] ??= new Date(now).toISOString();
        state.later[id] = new Date(until).toISOString();
      }
      return true;
    });
  }

  // ---- Mechanical cleaning -------------------------------------------------------------------

  /** Trims "Done lately", removes attachments nothing has linked to for a week, and old versions. */
  async sweep(now = Date.now()): Promise<void> {
    if (!this.exists()) return;
    await this.ignore();
    const tasks = join(this.dir, TASKS);
    await withFileMutationQueue(tasks, async () => {
      const content = await readText(tasks);
      if (content === undefined) return;
      const trimmed = trimDone(content, DONE_KEPT);
      if (trimmed !== content) await write(tasks, trimmed);
    });

    const files = await this.files();
    const attachments = files.filter((rel) => kindOf(rel) === "attachment");
    if (attachments.length) {
      const texts = (
        await Promise.all(files.filter((rel) => rel.endsWith(".md") && kindOf(rel) !== "attachment").map((rel) => this.text(rel)))
      ).join("\n");
      for (const rel of attachments) {
        const name = rel.slice("attachments/".length);
        if (texts.includes(name) || texts.includes(encodeURI(name))) continue;
        const age =
          now -
          (await stat(join(this.dir, rel)).then(
            (s) => s.mtimeMs,
            () => now,
          ));
        if (age > UNLINKED_DAYS * 86_400_000) await rm(join(this.dir, rel), { force: true });
      }
    }

    // Only questions still waiting are remembered.
    const open = new Set(questions((await this.text(TASKS)) ?? "").map((q) => q.id));
    await this.changeState((state) => {
      let changed = false;
      for (const map of [state.asked, state.later])
        for (const id of Object.keys(map))
          if (!open.has(id)) {
            delete map[id];
            changed = true;
          }
      return changed;
    });

    for (const name of (await this.versions()).slice(HISTORY_KEPT)) await rm(join(this.history, name), { force: true });
  }
}

export { NOTES, TASKS };
