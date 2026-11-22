/**
 * The contribution points of a session that this web client draws (`ContributionPoint` in
 * apps/web). The core knows only that a point is an item of the history (`item.tool:<name>`,
 * `item.custom:<type>`) or one its host names.
 */
export const WORKSPACE_POINTS = [
  "session.title",
  "session.header",
  "session.status",
  // A panel in the session's Details, titled by its contribution.
  "session.details",
  // A whole view of the session, beside the conversation.
  "session.view",
  "session.input.above",
  "session.input.below",
  "session.input.actions",
  // A fenced block in Markdown, by its language: `markdown.fence:mermaid` draws ```mermaid blocks.
  "markdown.fence:*",
] as const;
