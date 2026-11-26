import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { basename, extname, join, relative, isAbsolute, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { detectSupportedImageMimeTypeFromFile, resizeImage, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import { RuntimeError } from "./errors.js";

/** The most one attachment may weigh. */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** The most attachments one message may name. */
export const ATTACHMENTS_PER_MESSAGE = 20;

/**
 * Files a person attaches to a message: `sessions/<id>/files/<name>`, kept, archived and deleted with
 * the session. A message names each one where it sits in the text as `<file name="<absolute path>"></file>`,
 * the tag terminal Pi uses, so the agent opens it with its tools. Images also go to the model as content.
 */
export const filesFolder = (sessionFolder: string) => join(sessionFolder, "files");

/** Upload ownership is recorded before a file is published, independently of the draft. */
export function uploadedNames(sessionFolder: string): Set<string> {
  try {
    return new Set(readdirSync(join(sessionFolder, "uploads")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

/** A name a person's file can be stored under: one plain file name, nothing that could reach elsewhere. */
export function validAttachmentName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 200 &&
    name === basename(name) &&
    !name.startsWith(".") &&
    !/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
  );
}

/**
 * Saves an upload under a free name (`name`, `name (2)`, …), written to a temporary file first so a cut
 * upload leaves nothing behind. Refuses more than `ATTACHMENT_MAX_BYTES`. Returns the stored name and size.
 */
export async function saveAttachment(sessionFolder: string, name: string, body: Readable): Promise<{ name: string; size: number }> {
  if (!validAttachmentName(name)) throw new RuntimeError("invalid-input");
  const folder = filesFolder(sessionFolder);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const partial = join(folder, `.upload-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let size = 0;
  try {
    await new Promise<void>((done, fail) => {
      const out = createWriteStream(partial, { mode: 0o600 });
      body.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > ATTACHMENT_MAX_BYTES) {
          body.destroy();
          out.destroy();
          fail(new RuntimeError("limit"));
        }
      });
      body.on("error", fail);
      body.on("aborted", () => fail(new RuntimeError("invalid-input")));
      out.on("error", fail);
      out.on("finish", () => done());
      body.pipe(out);
    });
    const stored = freeName(folder, name);
    const owners = join(sessionFolder, "uploads");
    mkdirSync(owners, { recursive: true, mode: 0o700 });
    const marker = join(owners, stored);
    writeFileSync(marker, "", { mode: 0o600 });
    try {
      renameSync(partial, join(folder, stored));
    } catch (error) {
      rmSync(marker, { force: true });
      throw error;
    }
    return { name: stored, size };
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

function freeName(folder: string, name: string): string {
  if (!existsSync(join(folder, name))) return name;
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existsSync(join(folder, candidate))) return candidate;
  }
  throw new RuntimeError("busy");
}

/** The path of a stored attachment, or undefined when there is none by that name. */
export function attachmentPath(sessionFolder: string, name: string): string | undefined {
  if (!validAttachmentName(name)) return undefined;
  const path = join(filesFolder(sessionFolder), name);
  try {
    return statSync(path).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

const tag = (path: string) => `<file name="${path}"></file>`;
const TAG = /<file name="([^"]+)"><\/file>/g;

/** A fresh fork owns its copied uploads. Rebase their tags without changing the source transcript. */
export function forkAttachmentTags(entry: SessionEntry, paths: ReadonlyMap<string, string>): SessionEntry {
  if (entry.type !== "message" || entry.message.role !== "user") return entry;
  const move = (text: string) => text.replace(TAG, (whole, path: string) => {
    const moved = paths.get(path);
    return moved ? tag(moved) : whole;
  });
  const { content } = entry.message;
  return {
    ...entry,
    message: {
      ...entry.message,
      content: typeof content === "string" ? move(content)
        : content.map((part) => part.type === "text" ? { ...part, text: move(part.text) } : part),
    },
  };
}

/** Only a recorded user message referring to a file in this session makes an upload an artifact. */
export function sentAttachmentNames(sessionFolder: string, entries: readonly SessionEntry[]): Set<string> {
  const folder = filesFolder(sessionFolder);
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const { content } = entry.message;
    const text = typeof content === "string" ? content : content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
    for (const [, path] of text.matchAll(TAG)) {
      const name = path && isAbsolute(path) ? relative(folder, path) : "";
      if (validAttachmentName(name) && name !== "..") names.add(name);
    }
  }
  return names;
}

/**
 * The text a message sends: each `<file name="<attachment name>"></file>` the person placed becomes the
 * attachment's absolute path, and an attachment the text does not place is added at the end. Every name
 * must be a stored attachment of this session.
 */
export function placeAttachments(sessionFolder: string, text: string, names: readonly string[]): string {
  if (names.length > ATTACHMENTS_PER_MESSAGE || new Set(names).size !== names.length) throw new RuntimeError("invalid-input");
  const paths = new Map<string, string>();
  for (const name of names) {
    const path = attachmentPath(sessionFolder, name);
    if (!path) throw new RuntimeError("not-found");
    paths.set(name, path);
  }
  const placed = new Set<string>();
  let out = text.replace(TAG, (whole, name: string) => {
    const path = paths.get(name);
    if (!path || placed.has(name)) return whole;
    placed.add(name);
    return tag(path);
  });
  const rest = names.filter((name) => !placed.has(name));
  if (rest.length) out = `${out}${/\s$/.test(out) || !out ? "" : "\n"}${rest.map((name) => tag(paths.get(name)!)).join("\n")}`;
  return out;
}

/** The text with each `<file>` tag as its file name, for a title made from a first message. */
export function namingFiles(text: string): string {
  return text
    .replace(TAG, (_whole, path: string) => ` ${path.split(/[\\/]/).pop() || path} `)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

/**
 * The images a message carries as content: every tag in its text that points at an image in this
 * session's own `files/` folder, in order, resized by Pi. A tag pointing anywhere else is never read.
 */
export async function attachedImages(sessionFolder: string, text: string): Promise<ImageContent[]> {
  const folder = resolve(filesFolder(sessionFolder));
  let real: string;
  try {
    real = realpathSync.native(folder);
  } catch {
    return [];
  }
  const images: ImageContent[] = [];
  for (const [, path] of text.matchAll(TAG)) {
    if (!path || !isAbsolute(path)) continue;
    const inside = relative(folder, resolve(path));
    if (!inside || inside === ".." || inside.includes(sep) || isAbsolute(inside)) continue;
    let file: string;
    try {
      file = realpathSync.native(path);
    } catch {
      continue;
    }
    if (relative(real, file) !== inside) continue;
    const mimeType = await detectSupportedImageMimeTypeFromFile(file).catch(() => null);
    if (!mimeType) continue;
    const resized = await resizeImage(readFileSync(file), mimeType).catch(() => null);
    if (resized) images.push({ type: "image", data: resized.data, mimeType: resized.mimeType });
  }
  return images;
}
