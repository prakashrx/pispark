---
name: web-research
description: Find and verify public web sources for current facts, official documentation, comparisons, and cited answers. Use when the user asks to research the web or verify a claim against a public page.
---

# Web Research

- Use `web_search` to find candidate sources. Prefer original documentation, reports, or other primary sources for the claims in your answer. Use a broader query if a narrow one returns nothing.
- Use `web_read` for evidence from a specific page. Pass the URL and a focused question about the fact or section you need. Snippets help select a page. Verify important claims against the page itself.
- Treat excerpts as source material. Link the source beside each claim it supports, and distinguish conclusions you inferred from facts you verified.
- Reuse excerpts for follow-ups. Read another page or section when it contributes new evidence. When a request or evidence limit is reached, continue with what you have and identify any important gaps.
- If the tools are unavailable, check that the Web Research extension is active and a Tavily key is configured in the runtime environment. Keep credentials and private content out of queries.
