import { isIP } from "node:net";

const API = "https://api.tavily.com";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SOURCE_URL = 1_500;

export const SEARCH_RESULTS = 5;

/** Only public web URLs go to the search service. PiSpark never fetches these URLs itself. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_SOURCE_URL) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      isIP(host) ||
      /(?:^|\.)(?:local|localhost|internal|home\.arpa|ts\.net)$/.test(host) ||
      url.href.length > MAX_SOURCE_URL
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

type Result = {
  url?: unknown;
  title?: unknown;
  content?: unknown;
  raw_content?: unknown;
};

export class Tavily {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  search(query: string, signal?: AbortSignal): Promise<Result[]> {
    return this.post(
      "search",
      {
        query,
        max_results: SEARCH_RESULTS,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      },
      signal,
    );
  }

  read(url: string, focus: string, signal?: AbortSignal): Promise<Result[]> {
    return this.post(
      "extract",
      {
        urls: [url],
        query: focus,
        chunks_per_source: 3,
        extract_depth: "basic",
        format: "text",
        include_images: false,
        timeout: 12,
      },
      signal,
    );
  }

  private async post(path: "search" | "extract", body: object, signal?: AbortSignal): Promise<Result[]> {
    const deadline = AbortSignal.timeout(15_000);
    try {
      const response = await this.fetcher(API + "/" + path, {
        method: "POST",
        headers: { Authorization: "Bearer " + this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new WebServiceError("Web research credentials were rejected. Check TAVILY_API_KEY.");
        if (response.status === 429 || response.status === 432)
          throw new WebServiceError("The web research service is rate limited or out of quota.");
        throw new WebServiceError("The web research service returned HTTP " + response.status + ".");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new WebServiceError("The web research service returned an empty response.");
      const chunks: Buffer[] = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new WebServiceError("The web research response exceeded its size limit.");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
      }

      const { results } = JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {};
      if (!Array.isArray(results)) throw new WebServiceError("The web research service returned an invalid response.");
      return results.filter((result) => result && typeof result === "object");
    } catch (error) {
      signal?.throwIfAborted();
      if (deadline.aborted) throw new Error("The web research request timed out.");
      if (error instanceof WebServiceError) throw error;
      throw new Error("The web research service could not be reached or returned an unreadable response.");
    }
  }
}

class WebServiceError extends Error {}
