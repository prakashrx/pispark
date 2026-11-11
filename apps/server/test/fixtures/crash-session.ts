import { join } from "node:path";
import { SessionRuntime } from "../../src/core/runtime/session-runtime.js";
import { LocalProviderControl, eventually } from "./local-provider.js";
import { inFlight } from "./chat.js";

// The parent prepared <root>/home (persona "a" with the controlled and side-effect extensions).
const root = process.argv[2]!;
const provider = new LocalProviderControl();
const runtime = new SessionRuntime({
  home: join(root, "home"),
  fixedModel: { provider: provider.provider, id: "deterministic" },
});
const session = await runtime.create({ folder: join(root, "a"), persona: "a" });
runtime.start(session.id, "read:value.txt");
await eventually(() => provider.requests.length === 1);
provider.requests[0]!.release();
await eventually(
  () =>
    provider.requests.length === 2 && inFlight(runtime, session.id).length > 0,
);
process.send!({ id: session.id });
// Parent terminates this process during the second actual SDK request.
