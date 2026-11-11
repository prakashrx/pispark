/**
 * The places in the workspace's chat UI where an extension may put a component. The core only
 * knows that a slot is a content slot (`tool:<name>`, `custom:<type>`) or one of the places its
 * host names; these are the ones this web client draws (`ViewSlot` in apps/web).
 */
export const WORKSPACE_PLACES = [
  "chat.title",
  "chat.header",
  "reply.above",
  "reply.below",
  "reply.actions",
  "reply.footer",
] as const;
