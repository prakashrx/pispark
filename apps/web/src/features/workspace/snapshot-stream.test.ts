import { expect, test } from "vitest";
import { snapshots } from "./snapshot-stream";
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
test("snapshot-stream: pulls split and combined frames without retaining a replay buffer", async () => {
  const values = [];
  for await (const value of snapshots(
    response([
      "event: snap",
      'shot\ndata: {"sequence":1}\n',
      '\nevent: snapshot\ndata: {"sequence":3}\n\n',
    ]),
  ))
    values.push(value.sequence);
  expect(values).toEqual([1, 3]);
});
test("snapshot-stream: bounded incomplete frames and invalid framing fail closed", async () => {
  for (const value of [
    response(["x".repeat(256 * 1024), "x"]),
    response(["data: {}\n\n"]),
    response(["event: snapshot\ndata: not-json\n\n"]),
  ]) {
    await expect(async () => {
      for await (const _ of snapshots(value)) {
        /* consume */
      }
    }).rejects.toThrow();
  }
});
