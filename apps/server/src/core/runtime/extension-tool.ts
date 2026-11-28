import { Type, type Static } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const EXTENSION_TOOL = "pispark_extension";
export const EXTENSION_CHANNEL = "pispark:extension-request";
const name = Type.String({ maxLength: 64 });
const parameters = Type.Union([
  Type.Object({ action: Type.Literal("apply"), name }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("unload"), name }, { additionalProperties: false }),
  Type.Object(
    {
      action: Type.Literal("stage"),
      name: Type.String({ maxLength: 64 }),
      source: Type.String({ minLength: 1, maxLength: 1024 }),
      scope: Type.Optional(Type.Union([Type.Literal("session"), Type.Literal("project")])),
    },
    { additionalProperties: false },
  ),
  Type.Object({ action: Type.Literal("remove"), name: Type.String({ maxLength: 64 }) }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("reload"), revision: Type.String({ pattern: "^[a-f0-9]{64}$" }) }, { additionalProperties: false }),
]);
export interface ExtensionMessage {
  request: Static<typeof parameters>;
  signal?: AbortSignal;
  reply: (text: string, error?: boolean) => void;
  taken?: boolean;
}

export function registerExtensionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: EXTENSION_TOOL,
    label: "Develop session extensions",
    parameters,
    description:
      "Apply the authorized draft in this session's extension-drafts/<name>, or unload an active local extension. The session reloads with the change when this turn ends and you get the outcome as a new message, so end your turn after applying. For project sources, stage and reload the exact staged revision after approval.",
    async execute(_id, request, signal) {
      signal?.throwIfAborted();
      const text = await new Promise<string>((resolve, reject) => {
        const message: ExtensionMessage = { request, signal, reply: (text, error) => (error ? reject(new Error(text)) : resolve(text)) };
        pi.events.emit(EXTENSION_CHANNEL, message);
        if (!message.taken) reject(new Error("Session extension development is not enabled."));
      });
      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}
