import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SessionRuntime } from "../src/core/runtime/session-runtime.js";
import { SessionHttp } from "../src/http/session-http.js";
import { createAppServer } from "../src/http/server.js";
import { attachedImages, namingFiles, placeAttachments, validAttachmentName } from "../src/core/runtime/attachments.js";
import { eventually } from "./fixtures/local-provider.js";
import { testHome } from "./fixtures/home.js";
import type { ItemsPage, Receipt } from "../src/contract/protocol.js";

/** A 2×2 red PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
  "base64",
);

async function fixture(t: TestContext) {
  const h = await testHome("pispark-attachments-");
  const folder = await h.folder("work");
  await h.agent("default", { name: "Default" });
  const runtime = new SessionRuntime(h.configuration);
  const http = new SessionHttp(runtime);
  const server = createAppServer({ sessions: http });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await http.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(h.root, { recursive: true, force: true });
  });
  const post = async (command: Record<string, unknown>) => {
    const response = await fetch(`${base}/api/commands`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ commandId: randomUUID(), ...command }),
    });
    return { status: response.status, receipt: (await response.json()) as Receipt };
  };
  const settle = async (receipt: Receipt) => {
    while (receipt.state === "accepted") {
      await new Promise((r) => setTimeout(r, 5));
      receipt = (await (await fetch(`${base}/api/receipts/${receipt.commandId}`)).json()) as Receipt;
    }
    return receipt;
  };
  const created = await settle((await post({ type: "create", folder })).receipt);
  const id = created.sessionId!;
  const upload = (name: string, body: Buffer | string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/sessions/${id}/attachments`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name), ...headers },
      body: typeof body === "string" ? body : new Uint8Array(body),
    });
  return { base, runtime, provider: h.provider, post, settle, id, upload, sessions: join(h.home, "sessions") };
}

test("a title made from a message names its files, with a space between neighbours", () => {
  assert.equal(
    namingFiles('See <file name="C:/x/files/a.png"></file><file name="/y/b.txt"></file>and fix it\n<file name="/z/c.log"></file>'),
    "See a.png b.txt and fix it\nc.log",
  );
});

test("attachment names: one plain file name, nothing that could reach elsewhere", () => {
  for (const good of ["report.pdf", "Screenshot 2026-11-15 at 10.02.png", "日本語.txt", "a (2).log"]) assert.ok(validAttachmentName(good), good);
  for (const bad of ["", ".env", "../x", "a/b", "a\\b", "c:x", "con.txt", "NUL", "x.", "x ", "a\u0000b", "x".repeat(201)])
    assert.ok(!validAttachmentName(bad), JSON.stringify(bad));
});

test("uploads land in the session's files folder under a free name; refusals; served as inert data", async (t) => {
  const f = await fixture(t);
  const first = await f.upload("notes.txt", "hello");
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { name: "notes.txt", size: 5, type: "text/plain; charset=utf-8" });
  const second = await (await f.upload("notes.txt", "again")).json();
  assert.equal(second.name, "notes (2).txt");
  assert.deepEqual(readdirSync(join(f.sessions, f.id, "files")).sort(), ["notes (2).txt", "notes.txt"]);

  assert.equal((await f.upload("../escape.txt", "x")).status, 400);
  assert.equal((await f.upload(".env", "x")).status, 400);
  assert.equal((await f.upload("big.bin", "x", { "Content-Length": String(101 * 1024 * 1024) }).catch(() => ({ status: 413 }))).status !== 201, true);
  const unknown = await fetch(`${f.base}/api/sessions/${randomUUID()}/attachments`, {
    method: "POST",
    headers: { Origin: f.base, "X-File-Name": "a.txt" },
    body: "x",
  });
  assert.equal(unknown.status, 404, await unknown.clone().text());

  const served = await fetch(`${f.base}/api/sessions/${f.id}/attachments/${encodeURIComponent("notes (2).txt")}`);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), "again");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.match(served.headers.get("content-security-policy") ?? "", /sandbox/);
  assert.equal((await fetch(`${f.base}/api/sessions/${f.id}/attachments/missing.txt`)).status, 404);
  // An encoded path is refused before it reaches the route (the server's path guard) or by the name check.
  assert.ok([400, 404].includes((await fetch(`${f.base}/api/sessions/${f.id}/attachments/..%2Fsession.json`)).status));
  // No temporary upload files are left behind.
  assert.ok(readdirSync(join(f.sessions, f.id, "files")).every((name) => !name.startsWith(".upload-")));
});

test("a message names each attachment where it was placed; images also go as content; unknown names are refused", async (t) => {
  const f = await fixture(t);
  f.provider.automatic = true;
  await f.upload("log.txt", "line 1\nline 2");
  await f.upload("shot.png", PNG);
  const files = join(f.sessions, f.id, "files");

  const refused = await f.settle((await f.post({ type: "start", sessionId: f.id, text: "hi", attachments: ["nope.txt"] })).receipt);
  assert.equal(refused.outcome, "failed");
  assert.equal(refused.error, "not-found");
  assert.equal((await f.post({ type: "start", sessionId: f.id, text: "hi", attachments: ["../x"] })).status, 400);

  const text = 'See <file name="shot.png"></file> and the log';
  const done = await f.settle((await f.post({ type: "start", sessionId: f.id, text, attachments: ["shot.png", "log.txt"] })).receipt);
  assert.equal(done.outcome, "completed");
  const page = (await (await fetch(`${f.base}/api/sessions/${f.id}/items`)).json()) as ItemsPage;
  const user = page.items.find((item) => item.role === "user")!;
  const sent = user.parts.find((part) => part.type === "text") as { text: string };
  // The placed tag kept its place; the unplaced attachment follows at the end; both are absolute paths.
  assert.equal(
    sent.text,
    `See <file name="${join(files, "shot.png")}"></file> and the log\n<file name="${join(files, "log.txt")}"></file>`,
  );
  // The image went as content too.
  assert.equal(user.parts.filter((part) => part.type === "image").length, 1);
  // A title made from the first message names the files, not their paths.
  const { sessions } = (await (await fetch(`${f.base}/api/sessions`)).json()) as { sessions: { id: string; title?: string }[] };
  assert.equal(sessions.find((session) => session.id === f.id)?.title, "See shot.png and the log");
  await eventually(() => f.provider.requests.length > 0);
});

test("only images inside the session's own files folder are read as content", async (t) => {
  const f = await fixture(t);
  await f.upload("in.png", PNG);
  const session = join(f.sessions, f.id);
  const outside = join(f.sessions, "outside.png");
  writeFileSync(outside, PNG);
  // A name that starts with two dots is still in the folder.
  const dotted = join(session, "files", "..dots.png");
  writeFileSync(dotted, PNG);
  const text = `${placeAttachments(session, "", ["in.png"])} <file name="${outside}"></file> <file name="relative.png"></file> <file name="${dotted}"></file>`;
  const images = await attachedImages(session, text);
  assert.equal(images.length, 2);
  assert.ok(existsSync(join(session, "files", "in.png")));
});

test("a session's files list what the person attached and what the agent made there, newest first", async (t) => {
  const f = await fixture(t);
  f.provider.automatic = true;
  await f.upload("photo.png", "png-bytes");
  await f.upload("unsent.txt", "draft");
  // Sent with a message: the person's.
  await f.settle((await f.post({ type: "start", sessionId: f.id, text: "look", attachments: ["photo.png"] })).receipt);
  // The agent saves something there (as its PiSpark guidance says), and a dotfile is not listed.
  const folder = join(f.sessions, f.id, "files");
  writeFileSync(join(folder, "report.md"), "# Report");
  writeFileSync(join(folder, ".hidden"), "x");
  const listed = (await (await fetch(`${f.base}/api/sessions/${f.id}/attachments`)).json()) as { files: { name: string; size: number; by?: string }[] };
  assert.deepEqual(
    listed.files.map(({ name, by, size }) => ({ name, by, size })).sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "photo.png", by: "you", size: 9 },
      { name: "report.md", by: "agent", size: 8 },
    ],
  );
  // Each opens as inert data from the same place as an attachment.
  const report = await fetch(`${f.base}/api/sessions/${f.id}/attachments/report.md`);
  assert.equal(await report.text(), "# Report");
  assert.equal((await fetch(`${f.base}/api/sessions/${randomUUID()}/attachments`)).status, 400);
});

test("an uploaded image enters Artifacts only when recorded in a user message", async (t) => {
  const f = await fixture(t);
  f.provider.automatic = true;
  await f.upload("draft.png", "image bytes");
  const files = () => fetch(`${f.base}/api/sessions/${f.id}/attachments`).then((response) => response.json());
  assert.deepEqual(await files(), { files: [] });
  const failed = await f.post({ type: "start", sessionId: f.id, text: "send", attachments: ["draft.png", "missing.png"] });
  assert.equal((await f.settle(failed.receipt)).outcome, "failed");
  assert.deepEqual(await files(), { files: [] });
  const sent = await f.post({ type: "start", sessionId: f.id, text: "send", attachments: ["draft.png"] });
  assert.equal((await f.settle(sent.receipt)).outcome, "completed");
  const listed = await files() as { files: { name: string; by?: string }[] };
  assert.deepEqual(listed.files.map(({ name, by }) => ({ name, by })), [{ name: "draft.png", by: "you" }]);
});

test("a fork's sent attachments link to its own files after the source is deleted", async (t) => {
  const f = await fixture(t);
  f.provider.automatic = true;
  await f.upload("sent.txt", "shared notes");
  await f.upload("draft.txt", "unsent");
  const sent = await f.post({ type: "start", sessionId: f.id, text: "read later", attachments: ["sent.txt"] });
  await f.settle(sent.receipt);
  const forked = await f.settle((await f.post({ type: "fork", sessionId: f.id })).receipt);
  assert.equal(forked.outcome, "completed");
  const fork = forked.sessionId!;
  await f.settle((await f.post({ type: "archive", sessionId: f.id })).receipt);
  await f.settle((await f.post({ type: "delete", sessionId: f.id })).receipt);
  await f.settle((await f.post({ type: "open", sessionId: fork })).receipt);
  const page = await fetch(`${f.base}/api/sessions/${fork}/items`).then((response) => response.json());
  const user = page.items.find((item: { role: string }) => item.role === "user");
  assert.ok(user);
  const reference = user.parts.find((part: { type: string }) => part.type === "text").text;
  assert.ok(reference.includes(fork));
  assert.ok(!reference.includes(f.id));
  const files = await fetch(`${f.base}/api/sessions/${fork}/attachments`).then((response) => response.json());
  assert.deepEqual(files.files.map(({ name, by }: { name: string; by?: string }) => ({ name, by })), [{ name: "sent.txt", by: "you" }]);
  const file = await fetch(`${f.base}/api/sessions/${fork}/attachments/sent.txt`);
  assert.equal(await file.text(), "shared notes");
});
