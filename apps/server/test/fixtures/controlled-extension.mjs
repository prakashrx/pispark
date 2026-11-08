// Ordinary Pi extension. No PiSpark framework, manifest or provider network.
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
    // Pi's ctx.ui, as a browser answers it through PiSpark.
    const answer = (value) => pi.appendEntry("fixture-answer", { value: value ?? null });
    if (event.prompt === "ui-confirm")
      answer(await ctx.ui.confirm("Proceed?", "Fixture question"));
    if (event.prompt === "ui-select")
      answer(await ctx.ui.select("Pick one", ["one", "two"]));
    if (event.prompt === "ui-input") answer(await ctx.ui.input("Name", "type here"));
    if (event.prompt === "ui-timeout")
      answer(await ctx.ui.confirm("Quick?", "Times out", { timeout: 50 }));
    if (event.prompt === "ui-custom")
      answer(
        await ctx.ui.custom(() => {
          throw Error("Must never mount");
        }),
      );
    if (event.prompt === "ui-show") {
      ctx.ui.notify("Heads up", "warning");
      ctx.ui.setStatus("fixture", ctx.ui.theme.fg("accent", "ready"));
      ctx.ui.setWidget("fixture", ["widget line"], { placement: "belowEditor" });
      ctx.ui.setEditorText("drafted by fixture");
    }
    if (event.prompt === "ui-fail") throw new Error("fixture failure");
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
