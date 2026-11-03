import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../../src/runtime/session-runtime.js";
import { LocalProviderControl, eventually } from "./local-provider.js";

const root = process.argv[2]!;
const provider = new LocalProviderControl();
const runtime = new SessionRuntime({
  storageDir: join(root, "state"),
  workspaces: { a: join(root, "a") },
  configurations: {
    a: {
      modelId: "deterministic",
      provider: provider.provider,
      credential: { local: true },
      tools: ["read"],
      systemPrompt: "crash-test",
      extensions: [
        fileURLToPath(new URL("./controlled-extension.mjs", import.meta.url)),
        join(root, "side-effect.mjs"),
      ],
    },
  },
  resolveSecret: async () => {
    throw new Error("Must not consult credentials for explicit local provider");
  },
});
const session = await runtime.create({ workspace: "a", configuration: "a" });
runtime.start(session.id, "read:value.txt");
await eventually(() => provider.requests.length === 1);
provider.requests[0]!.release();
await eventually(
  () =>
    provider.requests.length === 2 && !!runtime.snapshot(session.id).partial,
);
process.send!({ id: session.id });
// Parent terminates this process during the second actual SDK request.
