import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { chatTitle, TITLE_TOOL } from "../runtime/chat-title.js";

/**
 * Ordinary native Pi extension, instantiated separately for every hosted session. Its title tool
 * names the session with Pi's own `setSessionName`; the session's name is the chat title.
 */
export default function pispark(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TITLE_TOOL,
    label: "Set chat title",
    description:
      "Give this chat a short, meaningful title when its purpose is clear. Update it only when the topic meaningfully changes.",
    parameters: Type.Object(
      { title: Type.String({ maxLength: 4096 }) },
      { additionalProperties: false },
    ),
    async execute(_id, parameters, signal) {
      if (signal?.aborted) throw new Error("Cancelled");
      const title = typeof parameters.title === "string" && parameters.title.length <= 4096 ? chatTitle(parameters.title) : "";
      if (!title) throw new Error("The title must contain printable text");
      pi.setSessionName(title);
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
