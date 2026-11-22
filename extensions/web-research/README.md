# Web Research

An optional Pi package with Tavily search, focused page reading, and a skill that explains when to use them.

## Installation

For terminal Pi, run `pi install /path/to/extensions/web-research` from a checkout. Set `TAVILY_API_KEY` in the environment of the process running Pi.

For PiSpark, copy `extensions/web-research/` and `skills/web-research/` from this package into the corresponding directories of the agent that should have access. For example, install the extension at `<data folder>/agents/<id>/extensions/web-research/index.ts` and the skill at `<data folder>/agents/<id>/skills/web-research/SKILL.md`. Set `TAVILY_API_KEY` in that PiSpark server's private `.env` file or start environment. Restart the server after changing the key, and reload existing sessions after changing agent resources. The extension and skill are standard agent resources and follow agent inheritance.

## Tools

- `web_search` takes a query and returns up to five source URLs with short previews.
- `web_read` takes a public URL and a focused question. It returns up to three relevant passages, capped at 2,500 bytes of excerpt text, together with the source URL.

A run shares a budget of six outbound requests and 8 KiB of evidence. Tavily receives queries, public URLs, and reading questions. The API key stays in the runtime environment. [Tavily documentation](https://docs.tavily.com/documentation/api-reference/introduction)

From the repository root, run `node --import tsx --test extensions/web-research/test/web-research.test.ts` to verify the package against the local tool and provider fixtures.
