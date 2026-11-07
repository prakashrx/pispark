import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import type { SessionHttp } from "./session-http.js";
import { silentLogger, type SafeLogger } from "./logger.js";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function isInside(root: string, file: string) {
  const path = relative(root, file);
  return (
    path !== ".." &&
    !path.startsWith("../") &&
    !path.startsWith("..\\") &&
    !isAbsolute(path)
  );
}

async function serveStatic(
  path: string,
  webRoot: string,
  response: ServerResponse,
  head: boolean,
) {
  // Only the built entry, icon, and assets are served directly.
  if (path !== "/" && path !== "/favicon.svg" && !path.startsWith("/assets/"))
    return false;
  const file = resolve(webRoot, path === "/" ? "index.html" : `.${path}`);
  if (!isInside(webRoot, file)) return false;
  const contentType = contentTypes[extname(file)];
  if (!contentType) return false;

  try {
    const [root, canonicalFile] = await Promise.all([
      realpath(webRoot),
      realpath(file),
    ]);
    // Containment must hold after resolving symlinks as well as before.
    if (!isInside(root, canonicalFile) || !(await stat(canonicalFile)).isFile())
      return false;
    const body = await readFile(canonicalFile);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
    });
    response.end(head ? undefined : body);
    return true;
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return false;
    throw error;
  }
}

export function createAppServer({
  webRoot,
  sessions,
  logger = silentLogger,
}: {
  webRoot?: string;
  sessions?: SessionHttp;
  logger?: SafeLogger;
} = {}): Server {
  const root = webRoot ? resolve(webRoot) : undefined;
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    try {
      let path: string;
      try {
        // Read the raw path, not a URL-normalized path which could hide traversal segments.
        path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
      } catch {
        json(response, 400, { error: "Invalid path" });
        return;
      }
      if (
        !path.startsWith("/") ||
        /[\\\0]/.test(path) ||
        path.split("/").some((part) => part.startsWith("."))
      ) {
        json(response, 400, { error: "Invalid path" });
        return;
      }
      if (path === "/api" || path.startsWith("/api/")) {
        if (sessions && path !== "/api/health") {
          await sessions.handle(request, response);
        } else if (path !== "/api/health") {
          json(response, 404, { error: "API route not found" });
        } else if (request.method === "GET") {
          json(response, 200, { status: "ok", service: "pispark" });
        } else {
          response.setHeader("Allow", "GET");
          json(response, 405, { error: "Method not allowed" });
        }
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        json(response, 405, { error: "Method not allowed" });
        return;
      }
      if (
        root &&
        (await serveStatic(path, root, response, request.method === "HEAD"))
      )
        return;
      // SPA fallback for non-asset, non-API GET requests.
      if (
        root &&
        request.method === "GET" &&
        !path.startsWith("/api/") &&
        !path.startsWith("/assets/") &&
        (await serveStatic("/", root, response, false))
      )
        return;
      json(response, 404, { error: "Not found" });
    } catch {
      // Request errors can contain provider/tool secrets; never log raw exceptions.
      logger.event(
        "http.failure",
        { code: "execution", outcome: "failed" },
        "error",
      );
      if (response.headersSent) response.end();
      else json(response, 500, { error: "Internal server error" });
    }
  });
}
