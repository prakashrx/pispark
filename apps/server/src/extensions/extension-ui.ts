import { randomUUID } from "node:crypto";
import type {
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionDialog, ExtensionView, StyledLine } from "../protocol.js";
import { RuntimeError } from "../runtime/errors.js";
import { renderComponent, styledLines, webTheme, webTui } from "./styled-text.js";

type Answer = string | boolean | undefined;
type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };
interface Widget {
  placement: "above" | "below";
  lines?: StyledLine[];
  component?: Component & { dispose?(): void };
}
type Notice = ExtensionView["notices"][number];
type Question = ExtensionDialog extends infer D
  ? D extends ExtensionDialog
    ? Omit<D, "id" | "expiresAt">
    : never
  : never;

const MAX_NOTICES = 50;
const MAX_TEXT = 64 * 1024;
const plain = (text: string, limit = 2000) =>
  styledLines(String(text))
    .map((line) => line.map((span) => span.text).join(""))
    .join("\n")
    .slice(0, limit);

/**
 * One chat's answer to Pi's `ctx.ui`: what Pi's own non-terminal mode supports, kept as
 * session state the browser shows. Terminal-only calls are quiet no-ops, as in Pi's RPC mode.
 */
export class ExtensionUI {
  private readonly dialogs = new Map<
    string,
    { dialog: ExtensionDialog; settle: (answer: Answer) => void }
  >();
  private readonly statuses = new Map<string, StyledLine>();
  private readonly widgets = new Map<string, Widget>();
  private notices: Notice[] = [];
  private counter = 0;
  private working?: string;
  private draft?: { id: string; text: string; at: number };
  private closed = false;

  constructor(
    private readonly host: {
      /** Something visible changed. */
      changed: () => void;
      /** Messages so far, so notices stay where they happened. */
      position: () => number;
    },
  ) {}

  private ask<T>(
    dialog: Question,
    options: ExtensionUIDialogOptions | undefined,
    fallback: T,
    accept: (answer: string | boolean) => T,
  ): Promise<T> {
    if (this.closed || options?.signal?.aborted) return Promise.resolve(fallback);
    const id = randomUUID();
    return new Promise<T>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (answer: Answer) => {
        if (!this.dialogs.delete(id)) return;
        clearTimeout(timer);
        options?.signal?.removeEventListener("abort", dismiss);
        resolve(answer === undefined ? fallback : accept(answer));
        this.host.changed();
      };
      const dismiss = () => settle(undefined);
      options?.signal?.addEventListener("abort", dismiss, { once: true });
      const timeout = options?.timeout;
      if (timeout && timeout > 0) timer = setTimeout(dismiss, timeout);
      this.dialogs.set(id, {
        dialog: {
          ...dialog,
          id,
          ...(timeout && timeout > 0 ? { expiresAt: Date.now() + timeout } : {}),
        } as ExtensionDialog,
        settle,
      });
      this.host.changed();
    });
  }

  private setWidget(
    key: string,
    content: string[] | WidgetFactory | undefined,
    options?: ExtensionWidgetOptions,
  ) {
    this.widgets.get(key)?.component?.dispose?.();
    this.widgets.delete(key);
    const placement = options?.placement === "belowEditor" ? "below" : "above";
    if (Array.isArray(content))
      this.widgets.set(key, { placement, lines: styledLines(content) });
    else if (typeof content === "function" && !this.closed)
      this.widgets.set(key, {
        placement,
        component: content(webTui(this.host.changed), webTheme),
      });
    this.host.changed();
  }

  private notice(message: string, kind: Notice["kind"]) {
    this.notices = [
      ...this.notices,
      {
        id: ++this.counter,
        kind,
        lines: styledLines(String(message).slice(0, MAX_TEXT)),
        after: this.host.position(),
        at: Date.now(),
      },
    ].slice(-MAX_NOTICES);
    this.host.changed();
  }

  /** Pi's extension UI for this chat's session. */
  readonly context: ExtensionUIContext = {
    select: (title, options, opts) =>
      this.ask(
        { kind: "select", title: plain(title), options: options.slice(0, 50).map((o) => plain(o, 500)) },
        opts,
        undefined,
        // Answers name the option as shown; give the extension its own string back.
        (answer) => options.find((o) => plain(o, 500) === answer),
      ),
    confirm: (title, message, opts) =>
      this.ask(
        { kind: "confirm", title: plain(title), message: plain(message) },
        opts,
        false,
        (answer) => answer === true,
      ),
    input: (title, placeholder, opts) =>
      this.ask(
        { kind: "input", title: plain(title), ...(placeholder ? { placeholder: plain(placeholder, 500) } : {}) },
        opts,
        undefined,
        (answer) => (typeof answer === "string" ? answer : undefined),
      ),
    editor: (title, prefill) =>
      this.ask(
        { kind: "editor", title: plain(title), ...(prefill ? { prefill: String(prefill).slice(0, MAX_TEXT) } : {}) },
        undefined,
        undefined,
        (answer) => (typeof answer === "string" ? answer : undefined),
      ),
    notify: (message, type) => this.notice(message, type ?? "info"),
    setStatus: (key, text) => {
      if (text === undefined) this.statuses.delete(key);
      else this.statuses.set(key, styledLines(String(text).split("\n")[0]!)[0]!);
      this.host.changed();
    },
    setWidget: (key: string, content: string[] | WidgetFactory | undefined, options?: ExtensionWidgetOptions) =>
      this.setWidget(key, content, options),
    setWorkingMessage: (message) => {
      this.working = message ? plain(message, 200) : undefined;
      this.host.changed();
    },
    setEditorText: (text) => {
      // Unique across session instances, so a reopened chat never reuses an applied id.
      this.draft = { id: randomUUID(), text: String(text).slice(0, MAX_TEXT), at: Date.now() };
      this.host.changed();
    },
    pasteToEditor: (text) => this.context.setEditorText(text),
    getEditorText: () => "",
    // Terminal-only, as in Pi's RPC mode.
    onTerminalInput: () => () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined as never,
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    theme: webTheme,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "PiSpark uses its own themes" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };

  /** A failing extension handler, shown instead of failing the chat. */
  extensionFailed(name: string, event: string, message: string) {
    this.notice(`The ${name} extension failed in ${event}: ${message.slice(0, 500)}`, "error");
  }

  answer(dialogId: string, answer: string | boolean | null): void {
    const pending = this.dialogs.get(dialogId);
    if (!pending) throw new RuntimeError("not-found");
    const { dialog } = pending;
    if (
      answer !== null &&
      !(dialog.kind === "select"
        ? typeof answer === "string" && dialog.options.includes(answer)
        : dialog.kind === "confirm"
          ? typeof answer === "boolean"
          : typeof answer === "string" && answer.length <= MAX_TEXT)
    )
      throw new RuntimeError("invalid-input");
    pending.settle(answer ?? undefined);
  }

  /** Dismiss open questions, e.g. when the run is cancelled, so waiting handlers finish. */
  dismissAll(): void {
    for (const { settle } of [...this.dialogs.values()]) settle(undefined);
  }

  close(): void {
    this.closed = true;
    this.dismissAll();
    for (const widget of this.widgets.values()) widget.component?.dispose?.();
    this.widgets.clear();
  }

  view(): ExtensionView {
    return {
      dialogs: [...this.dialogs.values()].map(({ dialog }) => dialog),
      statuses: [...this.statuses].map(([key, line]) => ({ key, line })),
      widgets: [...this.widgets].flatMap(([key, widget]) => {
        const lines = widget.component ? renderComponent(() => widget.component) : widget.lines;
        return lines?.length ? [{ key, placement: widget.placement, lines }] : [];
      }),
      notices: this.notices,
      ...(this.working ? { working: this.working } : {}),
      ...(this.draft ? { draft: this.draft } : {}),
    };
  }
}
