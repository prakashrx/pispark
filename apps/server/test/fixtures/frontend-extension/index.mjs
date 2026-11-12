// An ordinary Pi extension that offers its own view of the session: one Svelte component at
// `session.view`. It needs nothing from the extension but to be offered; everything it shows
// and does comes from the `session` PiSpark gives every component.
export default function (pi) {
  pi.events.emit("pispark:view", { point: "session.view", key: "log", title: "Log", component: new URL("./Log.svelte", import.meta.url) });
}
