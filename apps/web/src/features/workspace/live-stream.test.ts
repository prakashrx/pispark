import { expect, test } from "vitest";
import { liveEvents, workspaceEvents } from "./live-stream";
function response(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
test("live-stream: pulls split and combined frames of both kinds without retaining a replay buffer", async () => {
  const values = [];
  for await (const value of liveEvents(
    response([
      "event: snap",
      'shot\ndata: {"type":"snapshot","head":null}\n',
      '\nevent: ops\ndata: {"type":"ops","seq":1}\n\n',
    ]),
  ))
    values.push(value.type);
  expect(values).toEqual(["snapshot", "ops"]);
});
test("live-stream: bounded incomplete frames and invalid framing fail closed", async () => {
  for (const value of [
    response(["x".repeat(1024 * 1024), "x"]),
    response(["data: {}\n\n"]),
    response(["event: other\ndata: {}\n\n"]),
    response(["event: ops\ndata: not-json\n\n"]),
  ]) {
    await expect(async () => {
      for await (const _ of liveEvents(value)) {
        /* consume */
      }
    }).rejects.toThrow();
  }
});

test("workspace stream: ready, then which areas changed; a session's frames are not accepted there", async () => {
  const values = [];
  for await (const value of workspaceEvents(
    response(['event: ready\ndata: {"type":"ready"}\n\nevent: chan', 'ged\ndata: {"type":"changed","areas":["sessions","host"]}\n\n']),
  ))
    values.push(value);
  expect(values).toEqual([{ type: "ready" }, { type: "changed", areas: ["sessions", "host"] }]);
  await expect(async () => {
    for await (const _ of workspaceEvents(response(['event: ops\ndata: {"type":"ops"}\n\n']))) {
      /* none */
    }
  }).rejects.toThrow("Unexpected observation");
});
