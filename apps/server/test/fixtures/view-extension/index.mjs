// An ordinary Pi extension that shows Svelte components in PiSpark's slots with Pi's own event bus,
// and gives each the functions it may call. Terminal Pi has no listener for "pispark:view".
const file = (name) => new URL(name, import.meta.url);

export default function (pi) {
  let count = 0;
  const show = () =>
    pi.events.emit("pispark:view", {
      slot: "above-reply",
      key: "counter",
      component: file("./Counter.svelte"),
      props: { count },
      calls: {
        add: (by) => {
          count += by ?? 1;
          show();
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
  show();

  pi.events.emit("pispark:view", {
    slot: "header",
    component: file("./Banner.svelte"),
    props: { text: "Fixture banner" },
    calls: {
      removeCounter: () => pi.events.emit("pispark:view", { slot: "above-reply", key: "counter" }),
      placeOutside: () => pi.events.emit("pispark:view", { slot: "below-reply", component: file("../Outside.svelte") }),
      placeBroken: () => pi.events.emit("pispark:view", { slot: "below-reply", key: "broken", component: file("./Broken.svelte") }),
    },
  });
  pi.events.emit("pispark:view", { slot: "tool:shout", component: file("./Shout.svelte") });
  pi.events.emit("pispark:view", { slot: "entry:note", component: file("./Note.svelte") });

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
