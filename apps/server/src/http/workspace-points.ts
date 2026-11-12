/**
 * The contribution points of a session that this web client draws (`ContributionPoint` in
 * apps/web). The core knows only that a point is an item of the history (`item.tool:<name>`,
 * `item.custom:<type>`) or one its host names.
 */
export const WORKSPACE_POINTS = [
  "session.title",
  "session.header",
  "session.status",
  // A whole view of the session, beside the conversation.
  "session.view",
  "session.input.above",
  "session.input.below",
  "session.input.actions",
] as const;
