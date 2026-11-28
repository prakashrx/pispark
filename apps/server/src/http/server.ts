import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { SessionHttp } from "./session-http.js";
import { silentLogger, type SafeLogger } from "../core/logger.js";
import { isInside } from "../core/files.js";
import { logFailure } from "./io.js";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};
/** Files at the root of the built web app that are served as they are (the PWA's manifest, worker and icons). */
const ROOT_FILES = new Set(["/favicon.svg", "/manifest.webmanifest", "/sw.js", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]);

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function serveStatic(path: string, webRoot: string, response: ServerResponse, head: boolean) {
  // Only the built entry, icon, and assets are served directly.
  if (path !== "/" && !ROOT_FILES.has(path) && !path.startsWith("/assets/")) return false;
  const file = resolve(webRoot, path === "/" ? "index.html" : `.${path}`);
  if (!isInside(webRoot, file)) return false;
  const contentType = contentTypes[extname(file)];
  if (!contentType) return false;

  try {
    const [root, canonicalFile] = await Promise.all([realpath(webRoot), realpath(file)]);
    // Containment must hold after resolving symlinks as well as before.
    if (!isInside(root, canonicalFile) || !(await stat(canonicalFile)).isFile()) return false;
    const body = await readFile(canonicalFile);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
    });
    response.end(head ? undefined : body);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
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
        json(response, 400, { error: "invalid-input" });
        return;
      }
      if (!path.startsWith("/") || /[\\\0]/.test(path) || path.split("/").some((part) => part.startsWith("."))) {
        json(response, 400, { error: "invalid-input" });
        return;
      }
      if (path === "/api" || path.startsWith("/api/")) {
        if (sessions && path !== "/api/health") {
          await sessions.handle(request, response);
        } else if (path !== "/api/health") {
          json(response, 404, { error: "not-found" });
        } else if (request.method === "GET") {
          json(response, 200, { status: "ok", service: "pispark" });
        } else {
          response.setHeader("Allow", "GET");
          json(response, 405, { error: "invalid-input" });
        }
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        json(response, 405, { error: "invalid-input" });
        return;
      }
      if (root && (await serveStatic(path, root, response, request.method === "HEAD"))) return;
      // SPA fallback for non-asset, non-API GET requests.
      if (
        root &&
        request.method === "GET" &&
        !path.startsWith("/api/") &&
        !path.startsWith("/assets/") &&
        (await serveStatic("/", root, response, false))
      )
        return;
      json(response, 404, { error: "not-found" });
    } catch (error) {
      // Request errors can contain provider/tool secrets: the logger keeps only what kind of error it was.
      logFailure(logger, request, error, { status: 500, code: "execution" });
      if (response.headersSent) response.end();
      else json(response, 500, { error: "execution" });
    }
  });
}
