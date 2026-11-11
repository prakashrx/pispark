// An ordinary Pi extension that shows Svelte components in PiSpark's slots with Pi's own event bus,
// and gives each the functions it may call. Terminal Pi has no listener for "pispark:view".
const file = (name) => new URL(name, import.meta.url);
const show = (pi, view) => pi.events.emit("pispark:view", view);

export default function (pi) {
  // The count is the chat's state: saved in Pi's session with appendEntry, and read back from the
  // chat's branch when the session starts, so it survives a restart and follows forks.
  let count = 0;
  pi.on("session_start", (_event, ctx) => {
    const saved = ctx.sessionManager.getBranch().findLast((entry) => entry.type === "custom" && entry.customType === "counter");
    count = saved?.data?.count ?? 0;
    counter();
  });
  const counter = () =>
    show(pi, {
      slot: "reply.above",
      key: "counter",
      component: file("./Counter.svelte"),
      props: { count },
      calls: {
        add: (by) => {
          count += by ?? 1;
          pi.appendEntry("counter", { count });
          counter();
          return count;
        },
        jam: () => {
          throw new Error("The counter is jammed");
        },
        // Waits until PiSpark gives up on it.
        hang: (_data, { signal }) => new Promise((resolve) => signal.addEventListener("abort", resolve)),
        notJson: () => () => {},
      },
    });
  counter();

  let on = false;
  const toggle = () =>
    show(pi, {
      slot: "reply.actions",
      component: file("./Toggle.svelte"),
      props: { on },
      calls: {
        flip: () => {
          on = !on;
          toggle();
          return on;
        },
      },
    });
  toggle();

  show(pi, { slot: "chat.title", component: file("./Chip.svelte"), props: { text: "fixture chip" } });
  show(pi, { slot: "reply.footer", component: file("./Footer.svelte"), props: { text: "Fixture footer" } });
  show(pi, {
    slot: "chat.header",
    component: file("./Banner.svelte"),
    props: { text: "Fixture banner" },
    calls: {
      removeCounter: () => show(pi, { slot: "reply.above", key: "counter" }),
      placeOutside: () => show(pi, { slot: "reply.below", component: file("../Outside.svelte") }),
      placeBroken: () => show(pi, { slot: "reply.below", key: "broken", component: file("./Broken.svelte") }),
      placeNowhere: () => show(pi, { slot: "side.panel", component: file("./Chip.svelte") }),
      // The extension has the agent work: a user message, or a custom message that starts a turn.
      ask: (text) => {
        pi.sendUserMessage(text);
        return true;
      },
      nudge: (text) => {
        pi.sendMessage({ customType: "nudge", content: text, display: true }, { triggerTurn: true });
        return true;
      },
      placePage: () => page(true),
      removePage: () => page(false),
    },
  });
  // A page takes the chat area. It imports a static file and reads a data file from `files`.
  const page = (on) =>
    show(pi, on ? { slot: "chat.page", component: file("./Page.svelte"), props: { title: "Fixture page" }, files: file("./data/") } : { slot: "chat.page" });
  pi.registerCommand("page", { handler: async (args) => page(args.trim() !== "off") });
  show(pi, { slot: "tool:shout", component: file("./Shout.svelte") });
  show(pi, { slot: "custom:note", component: file("./Note.svelte") });

  pi.registerTool({
    name: "shout",
    label: "Shout",
    description: "Shout a word",
    parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
    async execute(_id, params) {
      return { content: [{ type: "text", text: params.word.toUpperCase() }], details: { loud: params.word.toUpperCase() } };
    },
  });
  pi.registerCommand("note", { handler: async (args) => pi.appendEntry("note", { text: args.trim() }) });
}
