import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ExtensionContribution } from "../protocol.js";
import type { Json } from "../stream-ops.js";
import { RuntimeError } from "../runtime/errors.js";
import { compileView } from "./view-compiler.js";

/** The one event an extension uses to place a component: `pi.events.emit(VIEW_EVENT, {...})`. */
export const VIEW_EVENT = "pispark:view";
/** The chat's contribution points. */
const SLOT = /^(tool:[\w.-]{1,64}|entry:[\w.:-]{1,64}|above-reply|below-reply|header)$/;
const KEY = /^[\w.:-]{0,64}$/;
const MAX_PROPS = 64 * 1024;
const MAX_CONTRIBUTIONS = 64;

interface Placed {
  slot: string;
  key: string;
  file: string;
  props?: Json;
  /** Set once the component compiled. */
  url?: string;
}

/** JSON that fits, or a reason it does not. */
function json(value: unknown, limit: number): Json | undefined {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text === undefined || text.length > limit) throw new Error("props must be JSON of at most 64 KiB");
  return JSON.parse(text) as Json;
}

/**
 * One chat's extension components. Extensions place them with an event on Pi's bus; nothing else
 * is needed, and terminal Pi, with no listener, ignores the event. A component must be a `.svelte`
 * file inside the folder of an extension the chat loads.
 */
export class ExtensionViews {
  private readonly placed = new Map<string, Placed>();
  private readonly compiled = new Map<string, Promise<string>>();
  private readonly roots: string[];
  private bus?: EventBus;
  private closed = false;

  constructor(
    extensionFolders: string[],
    private readonly host: {
      changed: () => void;
      /** A contribution that could not be used, in words for the chat. */
      failed: (message: string) => void;
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
    this.bus = bus;
    return bus.on(VIEW_EVENT, (data) => {
      try {
        this.place(data);
      } catch (error) {
        this.host.failed(`A view was not placed: ${(error as Error).message}`);
      }
    });
  }

  private file(component: unknown): string {
    if (typeof component !== "string" || component.length > 4096) throw new Error("component must be a file path or URL");
    const path = component.startsWith("file:") ? fileURLToPath(component) : component;
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
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("expected { slot, key?, component?, props? }");
    const { slot, key = "", component, props, ...rest } = data as Record<string, unknown>;
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
      props: json(props, MAX_PROPS),
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

  /** An event from a component, emitted on the chat's bus. PiSpark's own channels are not open to it. */
  emit(name: string, data: Json | undefined): void {
    if (!this.bus || this.closed) throw new RuntimeError("not-found");
    if (name.startsWith("pispark:")) throw new RuntimeError("invalid-input");
    this.bus.emit(name, data);
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
  }
}
