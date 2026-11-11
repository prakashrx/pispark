// An ordinary Pi extension that supplies its own frontend for the chat: one Svelte component in
// the `chat.page` slot. It needs nothing from the extension but to be placed; everything it shows
// and does comes from the `session` PiSpark gives every component.
export default function (pi) {
  pi.events.emit("pispark:view", { slot: "chat.page", component: new URL("./Log.svelte", import.meta.url) });
}
