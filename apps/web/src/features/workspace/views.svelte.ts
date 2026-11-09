import type { Component } from "svelte";
import type { AnySegment, ToolCall } from "./chat-turns";

/**
 * How the conversation is drawn is looked up, not written into the components: a kind of segment
 * has a view, and a tool has a view of what it did. PiSpark registers its own defaults through
 * the calls below, and a later registration for the same name wins until it is disposed, which
 * brings the previous one back. Components read the registry while rendering, so a registration
 * made after the chat is on screen redraws it.
 */

/** What a tool call is doing, in words: "Editing demo.ts", then "Edited demo.ts". */
export interface CallWords {
  /** While it runs. */
  doing: string;
  /** Once it finished. */
  done: string;
  /** What it works on, when its arguments say. */
  object?: string;
}

/** Everything a tool's calls contribute to the conversation. Every member but `describe` is optional. */
export interface ToolView {
  describe(call: ToolCall): CallWords;
  /** Calls of tools that share a group read as one phrase in an activity's summary line. */
  group?: string;
  /** That phrase for the calls of one group, lower case: "read 3 files". */
  summarize?(calls: ToolCall[]): string;
  /** Segments worth reading in the message itself rather than inside the activity: a diff, a picture. */
  artifacts?(call: ToolCall): AnySegment[];
  /** The body of the call's row once it is opened. */
  detail?: Component<{ call: ToolCall }>;
}

/** What a view of one kind of segment is given. */
export interface SegmentProps<S = AnySegment> {
  segment: S;
  sessionId: string;
}
// SAFETY: each registered view is typed for its own kind of segment; lookup is by that kind.
export type SegmentView = Component<SegmentProps<any>>;

/** Tools with no view of their own are described by their name alone. */
const GENERIC = "*";

class Views<V> {
  private readonly stacks = new Map<string, V[]>();
  /** Bumped on every change, so anything that resolved a view re-resolves. */
  private revision = $state(0);
  register(name: string, view: V): () => void {
    this.stacks.set(name, [...(this.stacks.get(name) ?? []), view]);
    this.revision++;
    return () => {
      const without = (this.stacks.get(name) ?? []).filter((candidate) => candidate !== view);
      if (without.length) this.stacks.set(name, without);
      else this.stacks.delete(name);
      this.revision++;
    };
  }
  resolve(name: string): V | undefined {
    void this.revision;
    return this.stacks.get(name)?.at(-1);
  }
}

const tools = new Views<ToolView>();
const segments = new Views<SegmentView>();

/** Registers how a tool's calls look. Returns a function that removes the registration. */
export const registerToolView = (tool: string, view: ToolView) => tools.register(tool, view);
/** Registers how a kind of segment looks. Extensions name their own kinds `name:kind`. */
export const registerSegmentView = (kind: string, view: SegmentView) => segments.register(kind, view);
/** Registers the view for tools that have none of their own. */
export const registerGenericToolView = (view: ToolView) => tools.register(GENERIC, view);

const bare: ToolView = { describe: (call) => ({ doing: `Using ${call.name}`, done: `Used ${call.name}` }) };
export const resolveToolView = (tool: string): ToolView => tools.resolve(tool) ?? tools.resolve(GENERIC) ?? bare;
export const resolveSegmentView = (kind: string): SegmentView | undefined => segments.resolve(kind);
