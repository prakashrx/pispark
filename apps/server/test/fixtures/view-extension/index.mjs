// An ordinary Pi extension that places Svelte components in PiSpark's slots through Pi's own event
// bus. Terminal Pi has no listener for "pispark:view", so there the events do nothing.
const file = (name) => new URL(name, import.meta.url).href;
const view = (pi, slot, component, extra = {}) => pi.events.emit("pispark:view", { slot, component, ...extra });

export default function (pi) {
  let count = 0;
  const counter = () => view(pi, "above-reply", file("./Counter.svelte"), { key: "counter", props: { count } });

  counter();
  view(pi, "header", file("./Banner.svelte"), { props: { text: "Fixture banner" } });
  view(pi, "tool:shout", file("./Shout.svelte"));
  view(pi, "entry:note", file("./Note.svelte"));

  // Events from the components come back on the same bus; new props are the answer.
  pi.events.on("view-fixture:add", (data) => {
    count += data?.by ?? 1;
    counter();
  });
  pi.events.on("view-fixture:remove", () => pi.events.emit("pispark:view", { slot: "above-reply", key: "counter" }));
  pi.events.on("view-fixture:outside", () => view(pi, "below-reply", file("../Outside.svelte")));
  pi.events.on("view-fixture:broken", () => view(pi, "below-reply", file("./Broken.svelte"), { key: "broken" }));

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
