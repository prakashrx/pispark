import type { RichPiece, RichToken } from "../../lib/ui/RichInput.svelte";

/** The most one attachment may weigh, and how many one message may carry (the server's limits). */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 20;

/** A file a person added to a message, from the moment it is pasted until the message is sent. */
export interface Attachment {
  id: string;
  file: File;
  /** The name the server stored it under, once uploaded. */
  name?: string;
  state: "waiting" | "uploading" | "done" | "failed";
  progress: number;
  /** Why it failed, in words. */
  problem?: string;
  /** An image's picture, for the chip. */
  thumbnail?: string;
}

const TAG = /<file name="([^"]+)"><\/file>/g;
const tag = (name: string) => `<file name="${name}"></file>`;
const size = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
let next = 0;

/**
 * The attachments of one draft. A chip is kept in the draft text as `<file name="<id>"></file>` where it
 * sits, so a draft stays a string. A session's draft uploads each file at once; Ask's draft has no session
 * yet, so it uploads when it is sent.
 */
export class Attachments {
  items = $state<Record<string, Attachment>>({});
  private uploads = new Map<string, XMLHttpRequest>();

  /** Adds files; uploads them now when `sessionId` is given. Answers the ids to place in the text. */
  add(files: File[], sessionId?: string): string[] {
    const room = ATTACHMENTS_PER_MESSAGE - Object.keys(this.items).length;
    return files.slice(0, Math.max(0, room)).map((file) => {
      const id = `a${++next}${Math.random().toString(36).slice(2, 6)}`;
      const tooBig = file.size > ATTACHMENT_MAX_BYTES;
      this.items[id] = {
        id,
        file,
        state: tooBig ? "failed" : "waiting",
        progress: 0,
        ...(tooBig ? { problem: "over 100 MB" } : {}),
        ...(file.type.startsWith("image/") ? { thumbnail: URL.createObjectURL(file) } : {}),
      };
      if (sessionId && !tooBig) void this.upload(id, sessionId);
      return id;
    });
  }
  /** A chip left the text: its upload stops and it is forgotten (an uploaded file stays with the session). */
  remove(id: string) {
    this.uploads.get(id)?.abort();
    this.uploads.delete(id);
    const item = this.items[id];
    if (item?.thumbnail) URL.revokeObjectURL(item.thumbnail);
    delete this.items[id];
  }
  /** Uploads what has not been uploaded yet; whether all of `ids` are now on the server. */
  async uploadAll(ids: string[], sessionId: string): Promise<boolean> {
    await Promise.all(
      ids.map((id) => {
        const item = this.items[id];
        return item && item.state !== "done" && item.state !== "uploading" && !item.problem?.startsWith("over")
          ? this.upload(id, sessionId)
          : undefined;
      }),
    );
    while (ids.some((id) => this.items[id]?.state === "uploading")) await new Promise((r) => setTimeout(r, 50));
    return ids.every((id) => this.items[id]?.state === "done");
  }
  private upload(id: string, sessionId: string): Promise<void> {
    const item = this.items[id];
    if (!item) return Promise.resolve();
    item.state = "uploading";
    item.progress = 0;
    item.problem = undefined;
    return new Promise((done) => {
      const xhr = new XMLHttpRequest();
      this.uploads.set(id, xhr);
      xhr.open("POST", `/api/sessions/${sessionId}/attachments`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("X-File-Name", encodeURIComponent(item.file.name.replace(/[\\/:*?"<>|]/g, "_") || "file"));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && this.items[id]) this.items[id].progress = event.loaded / event.total;
      };
      const finish = (problem?: string, name?: string) => {
        this.uploads.delete(id);
        const current = this.items[id];
        if (current) {
          current.state = problem ? "failed" : "done";
          current.problem = problem;
          current.name = name;
          current.progress = problem ? 0 : 1;
        }
        done();
      };
      xhr.onload = () => {
        if (xhr.status === 201) {
          try {
            return finish(undefined, (JSON.parse(xhr.responseText) as { name: string }).name);
          } catch {
            return finish("upload failed");
          }
        }
        finish(xhr.status === 413 ? "over 100 MB" : "upload failed");
      };
      xhr.onerror = () => finish("upload failed");
      xhr.onabort = () => done();
      xhr.send(item.file);
    });
  }

  /** How each chip looks. */
  get tokens(): Record<string, RichToken> {
    const out: Record<string, RichToken> = {};
    for (const item of Object.values(this.items)) {
      const words = `${item.file.name}, ${size(item.file.size)}`;
      out[item.id] = {
        label: item.file.name,
        detail: item.problem ?? size(item.file.size),
        ...(item.thumbnail && !item.problem ? { thumbnail: item.thumbnail } : {}),
        ...(item.state === "uploading" ? { state: "working" as const, progress: item.progress } : {}),
        ...(item.state === "failed" ? { state: "failed" as const } : {}),
        description: item.state === "failed" ? `${words}: ${item.problem}` : item.state === "uploading" ? `${words}, uploading` : words,
      };
    }
    return out;
  }
  /** Some chip is still uploading, or failed: the message cannot go yet. */
  get blocked(): string | undefined {
    const items = Object.values(this.items);
    if (items.some((item) => item.state === "failed")) return "Remove the attachment that could not be added.";
    if (items.some((item) => item.state === "uploading")) return "Waiting for attachments to upload…";
    return undefined;
  }

  /** The draft as the rich input's pieces: each tag of a known attachment becomes its chip. */
  pieces(draft: string): RichPiece[] {
    const pieces: RichPiece[] = [];
    let at = 0;
    for (const match of draft.matchAll(TAG)) {
      if (!this.items[match[1]!]) continue;
      pieces.push(draft.slice(at, match.index), { token: match[1]! });
      at = match.index! + match[0].length;
    }
    pieces.push(draft.slice(at));
    return pieces.filter((piece) => piece !== "");
  }
  /** The rich input's pieces as the draft. */
  static draft(pieces: RichPiece[]): string {
    return pieces.map((piece) => (typeof piece === "string" ? piece : tag(piece.token))).join("");
  }
  /** The attachments a draft places, in order. */
  placed(draft: string): string[] {
    return [...draft.matchAll(TAG)].map((match) => match[1]!).filter((id) => this.items[id]);
  }
  /** What a send carries: the text with each chip named by its stored name, and those names in order. */
  outgoing(draft: string): { text: string; attachments: string[] } {
    const attachments: string[] = [];
    const text = draft.replace(TAG, (whole, id: string) => {
      const name = this.items[id]?.name;
      if (!name) return whole;
      attachments.push(name);
      return tag(name);
    });
    return { text, attachments };
  }
  /** After a send: the chips that went are forgotten. */
  sent(ids: string[]) {
    for (const id of ids) {
      const item = this.items[id];
      if (item?.thumbnail) URL.revokeObjectURL(item.thumbnail);
      delete this.items[id];
    }
  }
}

/** A file a sent message names: shown as a chip, or a thumbnail for an image; `url` when it is this session's. */
export interface NamedFile {
  name: string;
  image: boolean;
  url?: string;
}
/**
 * A sent message's text with its `<file>` tags as files, in place. A tag pointing into this session's own
 * `files/` folder links to the attachment; any other tag shows only its file name.
 */
export function namedFiles(text: string, sessionId: string | undefined): (string | NamedFile)[] {
  const out: (string | NamedFile)[] = [];
  let at = 0;
  for (const match of text.matchAll(TAG)) {
    const path = match[1]!;
    const parts = path.split(/[\\/]/);
    const name = parts[parts.length - 1] || path;
    const own =
      sessionId !== undefined &&
      parts.length >= 4 &&
      parts[parts.length - 2] === "files" &&
      parts[parts.length - 3] === sessionId &&
      parts[parts.length - 4] === "sessions";
    out.push(text.slice(at, match.index), {
      name,
      image: /\.(png|jpe?g|gif|webp)$/i.test(name),
      ...(own ? { url: `/api/sessions/${sessionId}/attachments/${encodeURIComponent(name)}` } : {}),
    });
    at = match.index! + match[0].length;
  }
  out.push(text.slice(at));
  return out.filter((piece) => piece !== "");
}
