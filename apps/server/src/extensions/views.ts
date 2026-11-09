import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ExtensionContribution } from "../protocol.js";
import type { Json } from "../stream-ops.js";
import { RuntimeError } from "../runtime/errors.js";
import { compileView } from "./view-compiler.js";

/** The one event an extension uses to show a component: `pi.events.emit(VIEW_EVENT, {...})`. */
export const VIEW_EVENT = "pispark:view";
/** The chat's contribution points. */
const SLOT = /^(tool:[\w.-]{1,64}|entry:[\w.:-]{1,64}|above-reply|below-reply|header)$/;
const NAME = /^[\w.:-]{1,64}$/;
const KEY = /^[\w.:-]{0,64}$/;
const MAX_JSON = 64 * 1024;
const MAX_CONTRIBUTIONS = 64;
const MAX_CALLS = 32;
const MAX_PENDING = 16;

/** A function a component may call: `host.call(name, data)` runs `calls[name](data, { signal })`. */
type Call = (data: Json | undefined, context: { signal: AbortSignal }) => unknown;

interface Placed {
  slot: string;
  key: string;
  file: string;
  props?: Json;
  calls: Record<string, Call>;
  /** Set once the component compiled. */
  url?: string;
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
 * props and the functions it may call; terminal Pi, with no listener, ignores the event. A
 * component must be a `.svelte` file inside the folder of an extension the chat loads, and it can
 * only reach the functions its own placement gave it.
 */
export class ExtensionViews {
  private readonly placed = new Map<string, Placed>();
  private readonly compiled = new Map<string, Promise<string>>();
  private readonly running = new Set<AbortController>();
  private readonly roots: string[];
  private closed = false;

  constructor(
    extensionFolders: string[],
    private readonly host: {
      changed: () => void;
      /** A contribution that could not be used, in words for the chat. */
      failed: (message: string) => void;
      /** How long a call may take. */
      callTimeoutMs?: number;
    },
  ) {
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

  private file(component: unknown): string {
    const text = component instanceof URL ? component.href : component;
    if (typeof text !== "string" || text.length > 4096) throw new Error("component must be a file URL or path");
    const path = text.startsWith("file:") ? fileURLToPath(text) : text;
    if (!isAbsolute(path) || !path.endsWith(".svelte")) throw new Error("component must be an absolute path to a .svelte file");
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
    if (!this.roots.some(inside)) throw new Error(`${path} is not inside an extension this chat loads`);
    return real;
  }

  private place(data: unknown) {
    if (this.closed) return;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("expected { slot, component, props?, calls?, key? }");
    const { slot, key = "", component, props, calls: given, ...rest } = data as Record<string, unknown>;
    if (Object.keys(rest).length) throw new Error(`unknown field ${Object.keys(rest)[0]}`);
    if (typeof slot !== "string" || !SLOT.test(slot)) throw new Error(`unknown slot ${String(slot)}`);
    if (typeof key !== "string" || !KEY.test(key)) throw new Error("key must be a short name");
    const id = `${slot}\u0000${key}`;
    // No component: remove what this slot and key held.
    if (component === undefined || component === null) {
      if (this.placed.delete(id)) this.host.changed();
      return;
    }
    const file = this.file(component);
    if (!this.placed.has(id) && this.placed.size >= MAX_CONTRIBUTIONS) throw new Error("too many views");
    const previous = this.placed.get(id);
    const entry: Placed = {
      slot,
      key,
      file,
      props: json(props, "props"),
      calls: calls(given),
      // New props for the same file show at once; the compiled component is reused.
      url: previous?.file === file ? previous.url : undefined,
    };
    this.placed.set(id, entry);
    this.host.changed();
    if (entry.url) return;
    // Each file compiles once per session; a reopened chat compiles it again, so edits show.
    let compiling = this.compiled.get(file);
    if (!compiling) this.compiled.set(file, (compiling = compileView(file)));
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

  /** Whether any component is placed in a slot; custom entries with one are sent to the browser. */
  has(slot: string): boolean {
    return [...this.placed.values()].some((entry) => entry.slot === slot);
  }

  /**
   * A component's `host.call(name, data)`: runs that function of its own placement and gives back
   * its result. Bounded, cancelled when the chat closes, and timed out.
   */
  async call(slot: string, key: string, name: string, data: Json | undefined): Promise<Json | undefined> {
    const fn = this.placed.get(`${slot}\u0000${key}`)?.calls[name];
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

  /** What the browser mounts: compiled contributions, in the order they were placed. */
  view(): ExtensionContribution[] {
    return [...this.placed.values()].flatMap(({ slot, key, url, props }) =>
      url ? [{ slot, key, url, ...(props === undefined ? {} : { props }) }] : [],
    );
  }

  close(): void {
    this.closed = true;
    this.placed.clear();
    for (const controller of this.running) controller.abort();
  }
}
