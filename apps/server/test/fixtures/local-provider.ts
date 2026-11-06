import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { dirname, join } from "node:path";
import type {
  AssistantMessage,
  Model,
  Api,
  Provider,
  StreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";

export interface LocalRequest {
  context: TranscriptContext;
  apiKey?: string;
  headers?: StreamOptions["headers"];
  model: Model<Api>;
  release: () => void;
  pushText: (delta: string) => void;
  aborted: boolean;
}
export class LocalProviderControl {
  requests: LocalRequest[] = [];
  active = 0;
  peak = 0;
  automatic = false;
  provider = (): Provider => {
    const model: Model<Api> = {
      id: "deterministic",
      name: "Deterministic local fixture",
      provider: "pispark-local-test",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1",
      input: ["text"],
      reasoning: false,
      contextWindow: 100_000,
      maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const stream = (
      selected: Model<Api>,
      context: TranscriptContext,
      options?: StreamOptions,
    ) => {
      const events = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        api: selected.api,
        provider: selected.provider,
        model: selected.id,
        content: [{ type: "text", text: "" }],
        stopReason: "stop",
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const request: LocalRequest = {
        context: structuredClone(context),
        apiKey: options?.apiKey,
        headers: structuredClone(options?.headers),
        model: structuredClone(selected),
        release,
        pushText: (delta) => {
          const part = message.content[0];
          if (part?.type !== "text")
            throw new Error("Text stream already finished");
          part.text += delta;
          events.push({
            type: "text_delta",
            contentIndex: 0,
            delta,
            partial: message,
          });
        },
        aborted: false,
      };
      const abort = () => {
        request.aborted = true;
        release();
      };
      options?.signal?.addEventListener("abort", abort, { once: true });
      if (options?.signal?.aborted) abort();
      this.requests.push(request);
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      events.push({ type: "start", partial: message });
      events.push({ type: "text_start", contentIndex: 0, partial: message });
      message.content = [{ type: "text", text: "partial-local" }];
      events.push({
        type: "text_delta",
        contentIndex: 0,
        delta: "partial-local",
        partial: message,
      });
      if (this.automatic) release();
      void gate.then(() => {
        this.active--;
        options?.signal?.removeEventListener("abort", abort);
        const user = context.messages.findLast((item) => item.role === "user");
        const text =
          user?.role === "user"
            ? typeof user.content === "string"
              ? user.content
              : user.content
                  .filter((item) => item.type === "text")
                  .map((item) => item.text)
                  .join("")
            : "";
        const last = context.messages.at(-1);
        if (request.aborted) {
          message.stopReason = "aborted";
          events.push({ type: "error", reason: "aborted", error: message });
        } else if (text === "provider-error") {
          message.stopReason = "error";
          message.errorMessage = `Fixture error ${options?.apiKey ?? ""}`;
          events.push({ type: "error", reason: "error", error: message });
        } else if (
          text === "read-skill-support" &&
          context.messages.filter((m) => m.role === "toolResult").length < 2
        ) {
          const system = context.messages
            .filter((m) => m.role === "system")
            .map(
              (m) =>
                `${typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join("\n")}\n${Object.values(m.sections ?? {}).join("\n")}`,
            )
            .join("\n");
          const location = /<location>(.*?)<\/location>/
            .exec(system)?.[1]
            ?.replaceAll("&amp;", "&")
            .replaceAll("&quot;", '"')
            .replaceAll("&apos;", "'")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">");
          if (!location) {
            message.stopReason = "error";
            message.errorMessage = "No advertised native skill";
            events.push({ type: "error", reason: "error", error: message });
            return;
          }
          const support = context.messages.some((m) => m.role === "toolResult");
          message.content = [
            {
              type: "toolCall",
              id: support ? "skill-support" : "skill-instructions",
              name: "read",
              arguments: {
                path: support
                  ? join(dirname(location), "references", "check.md")
                  : location,
              },
            },
          ];
          message.stopReason = "toolUse";
          events.push({ type: "done", reason: "toolUse", message });
        } else if (text.startsWith("title:") && last?.role !== "toolResult") {
          message.content = [
            {
              type: "toolCall",
              id: "local-title",
              name: "pispark_set_title",
              arguments: JSON.parse(text.slice(6)),
            },
          ];
          message.stopReason = "toolUse";
          events.push({ type: "done", reason: "toolUse", message });
        } else if (text.startsWith("read:") && last?.role !== "toolResult") {
          message.content = [
            {
              type: "toolCall",
              id: "local-read",
              name: "read",
              arguments: { path: text.slice(5) },
            },
          ];
          message.stopReason = "toolUse";
          events.push({ type: "done", reason: "toolUse", message });
        } else {
          const result =
            last?.role === "toolResult" ? JSON.stringify(last.content) : text;
          message.content = [{ type: "text", text: `local:${result}` }];
          events.push({ type: "done", reason: "stop", message });
        }
      });
      return events;
    };
    return {
      id: model.provider,
      name: model.name,
      // The runtime replaces this ambient resolver. A call is an isolation failure.
      auth: {
        apiKey: {
          name: "forbidden ambient auth",
          resolve: async () => {
            throw new Error("Ambient provider auth used");
          },
        },
      },
      getModels: () => [model],
      stream,
      streamSimple: stream,
    };
  };
}

export async function eventually(
  predicate: () => boolean,
  milliseconds = 5000,
): Promise<void> {
  const end = Date.now() + milliseconds;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
