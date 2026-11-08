import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { requestTitle, TITLE_TOOL } from "./host-protocol.js";

/** Ordinary native Pi extension, instantiated separately for every hosted session. */
export default function pispark(pi: ExtensionAPI): void {
  const lifetime = new AbortController();
  pi.on("session_shutdown", () => lifetime.abort());
  pi.registerTool({
    name: TITLE_TOOL,
    label: "Set chat title",
    description:
      "Give this chat a short, meaningful title when its purpose is clear. Update it only when the topic meaningfully changes.",
    parameters: Type.Object(
      { title: Type.String() },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      const activeSignal = signal
        ? AbortSignal.any([signal, lifetime.signal])
        : lifetime.signal;
      await requestTitle(pi.events, parameters.title, activeSignal);
      return {
        content: [{ type: "text", text: "Chat title updated." }],
        details: undefined,
      };
    },
  });
  pi.on("before_agent_start", (event) => {
    if (!pi.getActiveTools().includes(TITLE_TOOL)) return;
    const guidance =
      "PiSpark hosts this chat. Use pispark_set_title to give it a short, meaningful title when its purpose is clear; update only when the topic meaningfully changes.";
    event.systemPromptOptions.appendSystemPrompt = [
      event.systemPromptOptions.appendSystemPrompt,
      guidance,
    ]
      .filter(Boolean)
      .join("\n\n");
  });
}
