// An ordinary Pi extension that shows Svelte components in PiSpark's slots with Pi's own event bus,
// and gives each the functions it may call. Terminal Pi has no listener for "pispark:view".
const file = (name) => new URL(name, import.meta.url);
const show = (pi, view) => pi.events.emit("pispark:view", view);

export default function (pi) {
  let count = 0;
  const counter = () =>
    show(pi, {
      slot: "reply.above",
      key: "counter",
      component: file("./Counter.svelte"),
      props: { count },
      calls: {
        add: (by) => {
          count += by ?? 1;
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
    },
  });
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
