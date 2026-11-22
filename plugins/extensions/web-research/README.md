# Web Research

An optional Pi package with Tavily search, focused page reading, and a skill that explains when to use them.

## Installation

In PiSpark, open an agent's **Extensions** section and add **web-research** from Bundled. The agent records `bundled:web-research`. The extension and its companion skill load together at session start or reload.

Set `TAVILY_API_KEY` in the server environment or in the instance's private `.env` file, then restart the server.

## Tools

- `web_search` takes a query and returns up to five source URLs with short previews.
- `web_read` takes a public URL and a focused question. It returns up to three relevant passages, capped at 2,500 bytes of excerpt text, together with the source URL.

A run shares a budget of six outbound requests and 8 KiB of evidence. Tavily receives queries, public URLs, and reading questions. The API key stays in the runtime environment. [Tavily documentation](https://docs.tavily.com/documentation/api-reference/introduction)

From the repository root, run `node --import tsx --test plugins/extensions/web-research/test/web-research.test.ts` to verify the package against the local tool and provider fixtures.
