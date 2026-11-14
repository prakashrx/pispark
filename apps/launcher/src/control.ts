import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { join } from "node:path";
import { windows } from "./install.ts";

/**
 * The running launcher's local control channel: a named pipe on Windows, a Unix socket in the
 * install folder on Linux. The command line (`pispark status`, `stop`, `open`, `update`) and a
 * handover between launchers use it. One per install folder, which also keeps a second launcher out.
 */
export type ControlRequest = { cmd: "status" | "stop" | "open" | "update" | "restart" | "check" } | { cmd: "install"; version: string };

export interface ControlStatus {
  pid: number;
  version: string;
  launcher: number;
  server: string;
  address: string;
}

export function controlPath(root: string) {
  return windows ? `\\\\.\\pipe\\pispark-${createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 16)}` : join(root, "launcher.sock");
}

export function serveControl(root: string, handle: (request: ControlRequest) => Promise<unknown>): Promise<Server> {
  const path = controlPath(root);
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 4096) return socket.destroy();
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      let request: ControlRequest;
      try {
        request = JSON.parse(buffer.slice(0, end)) as ControlRequest;
      } catch {
        return socket.destroy();
      }
      void handle(request)
        .then((result) => socket.end(JSON.stringify({ ok: true, result }) + "\n"))
        .catch((error: Error) => socket.end(JSON.stringify({ ok: false, error: error.message }) + "\n"));
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve, reject) => {
    server.once("error", async (error: NodeJS.ErrnoException) => {
      // A socket file left by a launcher that died: remove it, but only if nobody answers on it.
      if (!windows && error.code === "EADDRINUSE" && existsSync(path) && !(await callControl(root, { cmd: "status" }, 1000))) {
        rmSync(path, { force: true });
        server.once("error", reject);
        server.listen(path, () => resolve(server));
        return;
      }
      reject(error);
    });
    server.listen(path, () => resolve(server));
  });
}

/** Asks the running launcher; undefined when none is running. */
export function callControl<T = unknown>(root: string, request: ControlRequest, timeoutMs = 5000): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const socket = connect(controlPath(root));
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", (chunk) => (buffer += chunk));
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const answer = JSON.parse(buffer) as { ok: boolean; result?: T; error?: string };
        if (answer.ok) resolve(answer.result);
        else reject(new Error(answer.error));
      } catch {
        resolve(undefined);
      }
    });
    socket.on("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}
