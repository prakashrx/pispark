import {
  sessionEntryToContextMessages,
  type AgentSession,
  type KeybindingHints,
} from "@earendil-works/pi-coding-agent";
import type { NativeMessage, RenderedEntry, StyledLine } from "../protocol.js";
import { renderComponent, webTheme } from "./styled-text.js";

type Rendered = NonNullable<NativeMessage["rendered"]>;
interface ToolCallPart {
  type: "toolCall";
  id: string;
  arguments?: unknown;
}

// There are no keys to press in the browser.
const hints: KeybindingHints = { keyText: () => "", keyHint: () => "" };

/**
 * Runs an extension's own Pi renderers (tool calls and results, custom messages, custom
 * entries) without a terminal. Results are cached per transcript item until it asks to redraw.
 */
export class ExtensionRendering {
  private readonly cache = new WeakMap<object, Rendered | undefined>();
  private readonly entryCache = new Map<string, StyledLine[] | undefined>();
  private readonly state = new Map<string, object>();

  constructor(
    private readonly session: AgentSession,
    private readonly changed: () => void,
  ) {}

  private redraw(item: object) {
    return () => {
      this.cache.delete(item);
      this.changed();
    };
  }

  /** A tool result or custom message, when an extension renders it. */
  message(message: object): Rendered | undefined {
    if (this.cache.has(message)) return this.cache.get(message);
    const item = message as {
      role?: string;
      toolName?: string;
      toolCallId?: string;
      customType?: string;
      isError?: boolean;
    };
    const rendered =
      item.role === "toolResult" ? this.tool(message, item) : item.role === "custom" ? this.custom(message) : undefined;
    this.cache.set(message, rendered);
    return rendered;
  }

  private tool(
    message: object,
    item: { toolName?: string; toolCallId?: string; isError?: boolean },
  ): Rendered | undefined {
    const runner = this.session.extensionRunner;
    const name = item.toolName ?? "";
    // Only extension renderers: PiSpark draws Pi's built-in tools itself.
    const renderers = runner.resolveToolRenderers(name, () => runner.getToolDefinition(name));
    if (!renderers?.renderCall && !renderers?.renderResult) return undefined;
    const id = item.toolCallId ?? "";
    const args = this.argumentsOf(id);
    let state = this.state.get(id);
    if (!state) this.state.set(id, (state = {}));
    const context = {
      ...hints,
      args,
      toolCallId: id,
      invalidate: this.redraw(message),
      lastComponent: undefined,
      state,
      cwd: this.session.sessionManager.getCwd(),
      executionStarted: true,
      argsComplete: true,
      isPartial: false,
      expanded: false,
      showImages: false,
      isError: item.isError === true,
      durationMs: undefined,
      outputPad: 0,
    };
    const call = renderers.renderCall
      ? renderComponent(() => renderers.renderCall!(args as never, webTheme, context))
      : undefined;
    const body = renderers.renderResult
      ? renderComponent(() =>
          renderers.renderResult!(message as never, { expanded: false, isPartial: false }, webTheme, context),
        )
      : undefined;
    return call || body ? { ...(call ? { call } : {}), ...(body ? { body } : {}) } : undefined;
  }

  private argumentsOf(toolCallId: string): unknown {
    const messages = this.session.messages;
    for (let index = messages.length - 1; index >= 0; index--) {
      const content = (messages[index] as { role?: string; content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      const part = (content as ToolCallPart[]).find((p) => p.type === "toolCall" && p.id === toolCallId);
      if (part) return part.arguments ?? {};
    }
    return {};
  }

  private custom(message: object): Rendered | undefined {
    const customType = (message as { customType?: string }).customType ?? "";
    const renderer = this.session.extensionRunner.getMessageRenderer(customType);
    if (!renderer) return undefined;
    const body = renderComponent(() =>
      renderer(message as never, { ...hints, expanded: false, outputPad: 0 }, webTheme),
    );
    return body ? { body } : undefined;
  }

  /** Custom entries with a renderer, placed among messages in [from, to] as terminal Pi does. */
  entries(from: number, to: number): RenderedEntry[] {
    const runner = this.session.extensionRunner;
    const entries: RenderedEntry[] = [];
    let position = 0;
    for (const entry of this.session.sessionManager.buildContextEntries()) {
      if (entry.type !== "custom") {
        position += sessionEntryToContextMessages(entry).length;
        continue;
      }
      if (position < from || position > to) continue;
      const renderer = runner.getEntryRenderer(entry.customType);
      if (!renderer) continue;
      if (!this.entryCache.has(entry.id))
        this.entryCache.set(
          entry.id,
          renderComponent(() => renderer(entry as never, { ...hints, expanded: false }, webTheme)),
        );
      const lines = this.entryCache.get(entry.id);
      if (lines)
        entries.push({ key: entry.id, after: position, at: Date.parse(entry.timestamp) || 0, lines });
    }
    return entries;
  }
}
