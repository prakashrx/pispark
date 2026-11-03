// Ordinary Pi extension. No PiSpark framework, manifest, UI or provider network.
export default function (pi) {
  let starts = 0;
  let busEvents = 0;
  pi.events.on("fixture-probe", () => {
    busEvents++;
  });
  pi.on("session_start", (_event, ctx) => {
    pi.appendEntry("fixture-start", {
      cwd: ctx.cwd,
      starts: ++starts,
      hasUI: ctx.hasUI,
      trusted: ctx.isProjectTrusted(),
    });
  });
  pi.on("before_agent_start", async (event, ctx) => {
    pi.events.emit("fixture-probe", {});
    pi.appendEntry("fixture-run", { busEvents, cwd: ctx.cwd });
    if (event.prompt === "ui-confirm")
      await ctx.ui.confirm("Unsupported", "Must fail");
    if (event.prompt === "ui-select")
      await ctx.ui.select("Unsupported", ["no"]);
    if (event.prompt === "ui-input") await ctx.ui.input("Unsupported");
    if (event.prompt === "ui-custom")
      await ctx.ui.custom(() => {
        throw Error("Must never mount");
      });
  });
  pi.on("input", async (event) => {
    if (event.text === "slow-input")
      await new Promise((resolve) => setTimeout(resolve, 80));
    return { action: "continue" };
  });
  pi.registerCommand("unsupported-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.on("session_shutdown", (_event, ctx) => {
    pi.appendEntry("fixture-stop", { idle: ctx.isIdle(), busEvents });
  });
}
