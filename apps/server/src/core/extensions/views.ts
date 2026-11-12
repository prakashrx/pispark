import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ExtensionContribution } from "../../contract/protocol.js";
import type { Json } from "../../contract/stream-ops.js";
import { RuntimeError } from "../runtime/errors.js";
import { compileView } from "./view-compiler.js";

/** The one event an extension uses to show a component: `pi.events.emit(VIEW_EVENT, {...})`. */
export const VIEW_EVENT = "pispark:view";
/**
 * The items of a session's history, the same for every client: `item.tool:<name>` (a tool's
 * output, like Pi's tool renderers) and `item.custom:<customType>` (custom messages and entries,
 * like Pi's message and entry renderers). Every other point is one the host's client draws, named
 * in its configuration.
 */
const ITEM_POINT = /^item\.(tool:[\w.-]{1,64}|custom:[\w.:-]{1,64})$/;
/**
 * The point that takes whole views of a session: each offer has a key and a title, the person
 * chooses which one shows, and an offer may ask to be shown. A client that draws it names it in
 * its points like any other.
 */
export const VIEW_POINT = "session.view";
const TITLE = /^\P{Cc}{1,40}$/u;
const MAX_VIEWS = 6;
const NAME = /^[\w.:-]{1,64}$/;
const KEY = /^[\w.:-]{0,64}$/;
const MAX_JSON = 64 * 1024;
const MAX_CONTRIBUTIONS = 64;
const MAX_CALLS = 32;
const MAX_PENDING = 16;

/** A function a component may call: `host.call(name, data)` runs `calls[name](data, { signal })`. */
type Call = (data: Json | undefined, context: { signal: AbortSignal }) => unknown;

interface Placed {
  point: string;
  key: string;
  file: string;
  props?: Json;
  calls: Record<string, Call>;
  /** A folder whose files the component may read (`host.file(path)`). */
  files?: string;
  /** Set once the component compiled. */
  url?: string;
  /** A whole view's name, for the person to choose it by. */
  title?: string;
  /** How many times a whole view asked to be shown. */
  attention?: number;
}

/** The extension's own error from a call, given back to the component that made it. */
export class CallError extends RuntimeError {
  constructor(readonly detail: string) {
    super("extension");
  }
}

/** JSON that fits, or a reason it does not. */
function json(value: unknown, what: string): Json | undefined {
  if (value === undefined) return undefined;
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined || text.length > MAX_JSON) throw new Error(`${what} must be JSON of at most 64 KiB`);
  return JSON.parse(text) as Json;
}

function calls(value: unknown): Record<string, Call> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("calls must be an object of functions");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CALLS) throw new Error("too many calls");
  for (const [name, fn] of entries)
    if (!NAME.test(name) || typeof fn !== "function") throw new Error(`calls.${name} must be a function with a short name`);
  return Object.fromEntries(entries) as Record<string, Call>;
}

/**
 * One chat's extension components. An extension shows one with an event on Pi's bus, giving it
 * props, the functions it may call and, if it wants, a folder of files it may read; terminal Pi,
 * with no listener, ignores the event. A component must be a `.svelte` file inside the folder of
 * an extension the chat loads, and it can only reach what its own placement gave it.
 */
export class ExtensionViews {
  private readonly placed = new Map<string, Placed>();
  private readonly compiled = new Map<string, Promise<string>>();
  private readonly running = new Set<AbortController>();
  private readonly roots: string[];
  private readonly points: ReadonlySet<string>;
  private closed = false;

  constructor(
    extensionFolders: string[],
    private readonly host: {
      changed: () => void;
      /** A contribution that could not be used, in words for the chat. */
      failed: (message: string) => void;
      /** How long a call may take. */
      callTimeoutMs?: number;
      /** The points the client draws, besides the items of the history. */
      points?: readonly string[];
    },
  ) {
    this.points = new Set(host.points);
    this.roots = extensionFolders.flatMap((folder) => {
      try {
        return [realpathSync.native(folder)];
      } catch {
        return [];
      }
    });
  }

  /** Listens on the chat's bus; called before extensions load, so none of their events are missed. */
  bind(bus: EventBus): () => void {
    return bus.on(VIEW_EVENT, (data) => {
      try {
        this.place(data);
      } catch (error) {
        this.host.failed(`A view was not placed: ${(error as Error).message}`);
      }
    });
  }

  /** An absolute path, from a `file:` URL (a `URL` or its string) or a path. */
  private path(value: unknown, what: string): string {
    const text = value instanceof URL ? value.href : value;
    if (typeof text !== "string" || text.length > 4096) throw new Error(`${what} must be a file URL or path`);
    const path = text.startsWith("file:") ? fileURLToPath(text) : text;
    if (!isAbsolute(path)) throw new Error(`${what} must be an absolute path`);
    return path;
  }
  /** The component's real path and the extension folder it is in. */
  private componentFile(component: unknown): { file: string; root: string } {
    const path = this.path(component, "component");
    if (!path.endsWith(".svelte")) throw new Error("component must be an absolute path to a .svelte file");
    let real: string;
    try {
      real = realpathSync.native(path);
    } catch {
      throw new Error(`${path} does not exist`);
    }
    const inside = (root: string) => {
      const rel = relative(root, real);
      return rel && !rel.startsWith("..") && !isAbsolute(rel);
    };
    const root = this.roots.find(inside);
    if (!root) throw new Error(`${path} is not inside an extension this chat loads`);
    return { file: real, root };
  }
  /** The folder a placement lets its component read files from. */
  private folder(files: unknown): string | undefined {
    if (files === undefined || files === null) return undefined;
    const path = this.path(files, "files");
    try {
      const real = realpathSync.native(path);
      if (statSync(real).isDirectory()) return real;
    } catch {
      /* Reported below. */
    }
    throw new Error(`files must be an existing folder: ${path}`);
  }

  private place(data: unknown) {
    if (this.closed) return;
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("expected { point, component, props?, calls?, files?, key?, title?, attention? }");
    const { point, key = "", title, attention, component, props, calls: given, files, ...rest } = data as Record<string, unknown>;
    if (Object.keys(rest).length) throw new Error(`unknown field ${Object.keys(rest)[0]}`);
    if (typeof point !== "string" || !(ITEM_POINT.test(point) || this.points.has(point))) throw new Error(`unknown point ${String(point)}`);
    if (typeof key !== "string" || !KEY.test(key)) throw new Error("key must be a short name");
    const view = point === VIEW_POINT;
    if (view && !key) throw new Error(`${point} needs a key`);
    if (!view && (title !== undefined || attention !== undefined)) throw new Error(`${point} takes no title or attention: only a view does`);
    const id = `${point}\u0000${key}`;
    // No component: remove what this point and key held.
    if (component === undefined || component === null) {
      if (this.placed.delete(id)) this.host.changed();
      return;
    }
    const { file, root } = this.componentFile(component);
    const previous = this.placed.get(id);
    if (!previous && this.placed.size >= MAX_CONTRIBUTIONS) throw new Error("too many views");
    if (view) {
      if (typeof title !== "string" || !TITLE.test(title.trim())) throw new Error("a view needs a title of 1 to 40 characters");
      if (attention !== undefined && typeof attention !== "boolean") throw new Error("attention must be true or false");
      if (!previous && this.count(point) >= MAX_VIEWS) throw new Error(`at most ${MAX_VIEWS} views at ${point}`);
    }
    const entry: Placed = {
      point,
      key,
      file,
      props: json(props, "props"),
      calls: calls(given),
      files: this.folder(files),
      // New props for the same file show at once; the compiled component is reused.
      url: previous?.file === file ? previous.url : undefined,
      // Each request to be shown counts once, so a client can tell a new one from one it has seen.
      ...(view ? { title: (title as string).trim(), attention: (previous?.attention ?? 0) + (attention ? 1 : 0) } : {}),
    };
    this.placed.set(id, entry);
    this.host.changed();
    if (entry.url) return;
    // Each file compiles once per session; a reopened chat compiles it again, so edits show.
    let compiling = this.compiled.get(file);
    if (!compiling) this.compiled.set(file, (compiling = compileView(file, root)));
    compiling.then(
      (hash) => {
        if (this.closed || this.placed.get(id) !== entry) return;
        entry.url = `/api/views/${hash}.js`;
        this.host.changed();
      },
      (error: Error) => {
        this.compiled.delete(file);
        if (this.closed || this.placed.get(id) !== entry) return;
        this.placed.delete(id);
        this.host.failed(`The view ${file} could not be compiled: ${error.message.slice(0, 500)}`);
        this.host.changed();
      },
    );
  }

  /** Whether any component is placed at a point; custom entries with one are sent to the browser. */
  has(point: string): boolean {
    return this.count(point) > 0;
  }
  private count(point: string): number {
    let count = 0;
    for (const entry of this.placed.values()) if (entry.point === point) count++;
    return count;
  }

  /**
   * A component's `host.call(name, data)`: runs that function of its own placement and gives back
   * its result. Bounded, cancelled when the chat closes, and timed out.
   */
  async call(point: string, key: string, name: string, data: Json | undefined): Promise<Json | undefined> {
    const fn = this.placed.get(`${point}\u0000${key}`)?.calls[name];
    if (this.closed || !fn) throw new RuntimeError("not-found");
    if (this.running.size >= MAX_PENDING) throw new RuntimeError("limit");
    const controller = new AbortController();
    this.running.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Report the timeout first, then tell the function to stop.
          reject(new RuntimeError("timeout"));
          controller.abort();
        }, this.host.callTimeoutMs ?? 30_000);
      });
      const cancelled = new Promise<never>((_, reject) =>
        controller.signal.addEventListener("abort", () => reject(new RuntimeError("closed")), { once: true }),
      );
      // Whichever loses the race may still reject later; that is not an error of the process.
      timeout.catch(() => {});
      cancelled.catch(() => {});
      let result: unknown;
      try {
        result = await Promise.race([Promise.resolve().then(() => fn(data, { signal: controller.signal })), timeout, cancelled]);
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
        throw new CallError(error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500));
      }
      try {
        return json(result, "The result");
      } catch (error) {
        throw new CallError((error as Error).message);
      }
    } finally {
      clearTimeout(timer);
      this.running.delete(controller);
    }
  }

  /**
   * A component's `host.file(path)`: the real path of a file inside the folder its own placement
   * named. Nothing outside that folder, and nothing when the placement named none.
   */
  file(point: string, key: string, path: string): string {
    const root = this.placed.get(`${point}\u0000${key}`)?.files;
    if (this.closed || !root || typeof path !== "string" || !path || path.length > 1024 || path.includes("\0"))
      throw new RuntimeError("not-found");
    try {
      const real = realpathSync.native(resolve(root, path));
      const rel = relative(root, real);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel) && statSync(real).isFile()) return real;
    } catch {
      /* Not there. */
    }
    throw new RuntimeError("not-found");
  }

  /** What the browser mounts: compiled contributions, in the order they were placed. */
  view(): ExtensionContribution[] {
    return [...this.placed.values()].flatMap(({ point, key, url, props, title, attention }) =>
      url
        ? [{ point, key, url, ...(props === undefined ? {} : { props }), ...(title === undefined ? {} : { title }), ...(attention ? { attention } : {}) }]
        : [],
    );
  }

  close(): void {
    this.closed = true;
    this.placed.clear();
    for (const controller of this.running) controller.abort();
  }
}
