import { shownSession, newSession } from "./ask";
import { test, expect } from "@playwright/test";

test.afterEach(async ({ request }) => {
  const { sessions } = await (await request.get("/api/sessions")).json();
  for (const session of sessions.filter(
    (s: { status: string }) => s.status !== "unloaded",
  )) {
    const response = await request.post("/api/commands", {
      data: {
        type: "stop",
        sessionId: session.id,
        commandId: crypto.randomUUID(),
      },
    });
    let receipt = await response.json();
    while (receipt.state === "accepted")
      receipt = await (
        await request.get(`/api/receipts/${receipt.commandId}`)
      ).json();
  }
});

test("real SDK via shared Ask/reply: streaming, native tools, cancellation, independent drafts and reconnect", async ({
  page,
  context,
  request,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: /^Backend: (Connected|Live)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", {
      name: "Agent: Default",
    }),
  ).toBeVisible();
  await ask.fill("hold alpha");
  await ask.press("Enter");
  await expect(page.getByText("partial-local", { exact: true })).toBeVisible();
  const a = await shownSession(page);
  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await reply.fill("Draft A");
  await newSession(page);
  await ask.fill("hold beta");
  await ask.press("Enter");
  await expect.poll(async () => ![null, a].includes(await shownSession(page))).toBe(true);
  const b = await shownSession(page);
  await expect(reply).toHaveText("");
  await reply.fill("Draft B");
  await page
    .getByRole("link", { name: /^hold alpha/ })
    .first()
    .click();
  await expect(reply).toHaveText("Draft A");
  await context.setOffline(true);
  await expect(
    page.getByRole("img", { name: /Backend: Reconnecting/ }),
  ).toBeVisible();
  const live = await (await request.get("/api/sessions")).json();
  expect(
    live.sessions.filter(
      (session: { status: string }) => session.status === "running",
    ),
  ).toHaveLength(2);
  await context.setOffline(false);
  // Online recovery reconnects without resending either command.
  await expect(page.getByText("partial-local", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const peer = await (await request.get(`/api/sessions/${b}`)).json();
  expect(peer.status).toBe("running");
  await reply.fill("read:sample.txt");
  await reply.press("Enter");
  await expect(
    page.getByText(/local:.*native browser tool result/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Read 1 file" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("native-session.png") });
  await page
    .getByRole("link", { name: /^hold beta/ })
    .first()
    .click();
  await expect(reply).toHaveText("Draft B");
  await page.getByRole("button", { name: "Stop response" }).click();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "hold beta", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
});

test("a failing extension handler is a visible notice and the session keeps working", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: /^Backend: (Connected|Live)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("ui-fail");
  await ask.press("Enter");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "The controlled extension failed in before_agent_start: fixture failure" });
  await expect(notice).toContainText("Error");
  await expect(page.getByText("local:ui-fail", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
});

for (const mode of ["ask", "reply"] as const) {
  test(`${mode}: delayed acceptance preserves newer draft revision, including edited away and back`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("img", { name: /^Backend: (Connected|Live)$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start session", exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");
    const ask = page.getByRole("textbox", {
      name: "Ask anything",
      exact: true,
    });
    await expect(
      page.getByRole("button", {
        name: "Agent: Default",
      }),
    ).toBeVisible();
    if (mode === "reply") {
      await ask.fill("seed");
      await ask.press("Enter");
      await expect(page.getByText("local:seed", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Send message", exact: true }),
      ).not.toHaveAttribute("aria-disabled", "true");
    }
    const input =
      mode === "ask"
        ? ask
        : page.getByRole("textbox", { name: "Reply to session" });
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entering = new Promise<void>((r) => {
      entered = r;
    });
    await page.route("**/api/commands", async (route) => {
      if (
        route.request().postDataJSON().type !==
        (mode === "ask" ? "create" : "start")
      )
        return route.continue();
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response });
    });
    await input.fill("submitted");
    await input.press("Enter");
    await entering;
    await input.fill("new unsent");
    await input.fill("submitted");
    release();
    await expect(
      page.getByText("local:submitted", { exact: true }),
    ).toBeVisible();
    // The new session opens; the newer draft waits on New session.
    if (mode === "ask") await newSession(page);
    await expect(input).toHaveText("submitted");
  });
}

test("background receipt failure stays with its originating session across selection changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: /^Backend: (Connected|Live)$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", {
      name: "Agent: Default",
    }),
  ).toBeVisible();
  await ask.fill("session B");
  await ask.press("Enter");
  await expect(
    page.getByText("local:session B", { exact: true }),
  ).toBeVisible();
  const b = await shownSession(page);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const entering = new Promise<void>((r) => {
    entered = r;
  });
  await page.route("**/api/receipts/*", async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    if (value.error === "execution") {
      entered();
      await gate;
    }
    await route.fulfill({ response });
  });
  await newSession(page);
  await ask.fill("provider-error");
  await ask.press("Enter");
  await entering;
  await expect.poll(async () => ![null, b].includes(await shownSession(page))).toBe(true);
  const a = await shownSession(page);
  expect(a).not.toBe(b);
  await page
    .getByRole("link", { name: /^session B/ })
    .first()
    .click();
  release();
  await expect(
    page.getByText("local:session B", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: /The run failed/ }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: /^provider-error/ })
    .first()
    .click();
  // Said once, in the conversation where it happened (design set 8/4): no notice repeats it.
  await expect(
    page.getByRole("alert").filter({ hasText: "The run failed: the model couldn’t finish." }),
  ).toBeVisible();
  await expect(page.getByText(/Reopen this session|was interrupted|failed on the server/)).toHaveCount(0);
});

for (const fail of [false, true]) {
  test(`reply ${fail ? "failure" : "acceptance"} after selection change preserves both session drafts`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("img", { name: /^Backend: (Connected|Live)$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start session", exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");
    const ask = page.getByRole("textbox", {
      name: "Ask anything",
      exact: true,
    });
    const reply = page.getByRole("textbox", { name: "Reply to session" });
    await expect(
      page.getByRole("button", {
        name: "Agent: Default",
      }),
    ).toBeVisible();
    await ask.fill("switch B");
    await ask.press("Enter");
    await expect(
      page.getByText("local:switch B", { exact: true }),
    ).toBeVisible();
    const b = await shownSession(page);
    await reply.fill("B unsent");
    await newSession(page);
    await ask.fill("switch A");
    await ask.press("Enter");
    await expect(
      page.getByText("local:switch A", { exact: true }),
    ).toBeVisible();
    const a = await shownSession(page);
    expect(a).not.toBe(b);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entering = new Promise<void>((r) => {
      entered = r;
    });
    await page.route("**/api/commands", async (route) => {
      if (route.request().postDataJSON().type !== "start")
        return route.continue();
      const response = fail ? undefined : await route.fetch();
      entered();
      await gate;
      await route.fulfill(
        response
          ? { response }
          : {
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({ error: "busy" }),
            },
      );
    });
    await reply.fill("A submitted");
    await reply.press("Enter");
    await entering;
    await reply.fill("A newer unsent");
    await page
      .getByRole("link", { name: /^switch B/ })
      .first()
      .click();
    release();
    await expect(reply).toHaveText("B unsent");
    await expect(
      page.getByRole("alert").filter({ hasText: /busy/ }),
    ).toHaveCount(0);
    await page
      .getByRole("link", { name: /^switch A/ })
      .first()
      .click();
    await expect(reply).toHaveText("A newer unsent");
    if (fail)
      await expect(
        page.getByText(
          "We couldn’t confirm whether that action went through. Check this session before trying again.",
          { exact: true },
        ),
      ).toBeVisible();
    else
      await expect(
        page.getByText("local:A submitted", { exact: true }),
      ).toBeVisible();
  });
}

for (const fail of [false, true]) {
  test(`Ask delayed start ${fail ? "failure" : "acceptance"} preserves newer edits`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("img", { name: /^Backend: (Connected|Live)$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start session", exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");
    const ask = page.getByRole("textbox", {
      name: "Ask anything",
      exact: true,
    });
    await expect(
      page.getByRole("button", {
        name: "Agent: Default",
      }),
    ).toBeVisible();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const entering = new Promise<void>((r) => {
      entered = r;
    });
    await page.route("**/api/commands", async (route) => {
      if (route.request().postDataJSON().type !== "start")
        return route.continue();
      const response = fail ? undefined : await route.fetch();
      entered();
      await gate;
      await route.fulfill(
        response
          ? { response }
          : {
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({ error: "busy" }),
            },
      );
    });
    await ask.fill("start delay");
    await ask.press("Enter");
    await entering;
    // Still on New session while the first message is on its way: the draft can change.
    await ask.fill("new draft during start");
    release();
    if (fail)
      await expect(
        page.getByText(
          "We couldn’t confirm whether that action went through. Check this session before trying again.",
          { exact: true },
        ),
      ).toBeVisible();
    else
      await expect(
        page.getByText("local:start delay", { exact: true }),
      ).toBeVisible();
    await newSession(page);
    await expect(ask).toHaveText("new draft during start");
  });
}

test("configuration/connectivity failures remain explicitly global, not selected-session errors", async ({
  page,
}) => {
  let fail = true;
  let catalogRequests = 0;
  const starts: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/commands") &&
      request.postDataJSON().type === "start"
    )
      starts.push(request.postDataJSON().text);
  });
  await page.route("**/api/catalog", (route) => {
    catalogRequests++;
    return fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "configuration" }),
        })
      : route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Can’t reach PiSpark");
  await expect(
    page.getByRole("button", { name: "Retry now", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Connection lost. Your session may still be running."),
  ).toHaveCount(0);
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await ask.fill("Retained offline draft");
  await page.getByText("Details", { exact: true }).first().click();
  await expect(
    page.getByText("Backend unavailable. Drafts have not been sent.", {
      exact: true,
    }),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry now", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await expect(ask).toHaveText("Retained offline draft");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(catalogRequests).toBe(2);
  expect(starts).toEqual([]);
});

for (const mode of ["ask", "reply"] as const) {
  for (const loss of ["acceptance", "settlement"] as const) {
    test(`${mode}: lost ${loss} after backend acceptance warns visibly with closed Details and exactly one effect`, async ({
      page,
      request,
    }, info) => {
      await page.goto("/");
      const ask = page.getByRole("textbox", {
        name: "Ask anything",
        exact: true,
      });
      await expect(
        page.getByRole("button", { name: "Start session", exact: true }),
      ).not.toHaveAttribute("aria-disabled", "true");
      if (mode === "reply") {
        const seed = `uncertainty seed ${Date.now()}`;
        await ask.fill(seed);
        await ask.press("Enter");
        await expect(
          page.getByText(`local:${seed}`, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Send message", exact: true }),
        ).not.toHaveAttribute("aria-disabled", "true");
      }
      const input =
        mode === "ask"
          ? ask
          : page.getByRole("textbox", { name: "Reply to session" });
      let starts = 0;
      let commandId = "";
      let sessionId = "";
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const entering = new Promise<void>((r) => {
        entered = r;
      });
      await page.route("**/api/commands", async (route) => {
        const command = route.request().postDataJSON();
        if (command.type !== "start") return route.continue();
        starts++;
        commandId = command.commandId;
        sessionId = command.sessionId;
        const response = await route.fetch(); // Real fixture host accepts before browser response loss.
        if (loss === "acceptance") {
          entered();
          await gate;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      if (loss === "settlement")
        await page.route("**/api/receipts/*", async (route) => {
          if (!commandId || !route.request().url().endsWith(commandId))
            return route.continue();
          await route.fetch();
          entered();
          await gate;
          await route.abort("failed");
        });
      const text = `uncertain ${mode} ${loss} ${Date.now()}`;
      await input.fill(text);
      await input.press("Enter");
      await entering;
      const retained =
        loss === "settlement" ? "New unsent draft while observing" : text;
      if (loss === "settlement") {
        // A new session's draft is typed on New session, while the session it started opens.
        if (mode === "ask") await newSession(page);
        await input.fill(retained);
        if (mode === "ask") await page.goBack();
      }
      release();
      const copy =
        loss === "acceptance"
          ? "We couldn’t confirm whether that action went through. Check this session before trying again."
          : "That action may still be running. Check this session before trying again.";
      const warning = page.getByText(copy, { exact: true });
      await expect(warning).toBeVisible(); // Text node itself, not an ancestor with hidden diagnostic text.
      const alert = page.getByRole("alert").filter({ has: warning });
      await expect(alert.locator("details")).not.toHaveAttribute("open", "");
      await expect(alert).not.toContainText("Reopen this session to try again.");
      await expect
        .poll(async () => {
          const history = await (
            await request.get(`/api/sessions/${sessionId}/items`)
          ).json();
          return history.items.filter(
            (m: { role: string; parts: unknown }) =>
              m.role === "user" && JSON.stringify(m.parts).includes(text),
          ).length;
        })
        .toBe(1);
      expect(starts).toBe(1);
      for (const width of [390, 1920]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1200,
        });
        await expect(warning).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`uncertainty-${width}.png`),
          fullPage: true,
        });
      }
      if (mode === "ask") await newSession(page);
      await expect(input).toHaveText(retained);
    });
  }
}

test("successful truncated session list is visible status without a draft, clears without clearing unrelated errors", async ({
  page,
}, info) => {
  let truncated = true;
  await page.route("**/api/sessions", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), truncated },
    });
  });
  await page.goto("/");
  const copy = "Showing your latest 256 sessions. Older sessions are still saved.";
  await expect(page.getByText(copy, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: copy }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(ask).toHaveText("");
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`truncated-status-${width}.png`),
      fullPage: true,
    });
  }
  await page.route("**/api/commands", (route) => route.abort("failed"));
  await ask.fill("Keep this draft");
  await ask.press("Enter");
  const warning = page.getByText(
    "We couldn’t confirm whether that action went through. Check your sessions before trying again.",
    { exact: true },
  );
  await expect(warning).toBeVisible();
  await expect(page.getByRole("alert").locator("details")).not.toHaveAttribute(
    "open",
    "",
  );
  truncated = false;
  // Nothing changed on the server, so the list is read again when the connection comes back.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(copy, { exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(warning).toBeVisible();
  await expect(ask).toHaveText("Keep this draft");
});

test("create polling loss with known receipt session stays global, keeps the draft on New session, and never opens or starts the new session", async ({
  page,
  request,
}, info) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  const seed = `Old displayed session ${Date.now()}`;
  await ask.fill(seed);
  await ask.press("Enter");
  await expect(page.getByText(`local:${seed}`, { exact: true })).toBeVisible();
  const oldId = await shownSession(page);
  let createdId = "";
  let createCommandId = "";
  const commands: string[] = [];
  await page.route("**/api/commands", async (route) => {
    const command = route.request().postDataJSON();
    commands.push(command.type);
    const response = await route.fetch();
    if (command.type !== "create") return route.fulfill({ response });
    let receipt = await response.json();
    while (receipt.state === "accepted") {
      await new Promise((resolve) => setTimeout(resolve, 20));
      receipt = await (
        await request.get(`/api/receipts/${command.commandId}`)
      ).json();
    }
    createdId = receipt.sessionId;
    createCommandId = command.commandId;
    // Protocol edge fixture: accepted receipt already identifies the real newly created empty session.
    await route.fulfill({ response, json: { ...receipt, state: "accepted" } });
  });
  await page.route("**/api/receipts/*", (route) =>
    route.request().url().endsWith(createCommandId) && createCommandId
      ? route.abort("failed")
      : route.continue(),
  );
  await newSession(page);
  await ask.fill("Unsent initial question");
  await ask.press("Enter");
  const warning = page.getByText(
    "That action may still be running. Check your sessions before trying again.",
    { exact: true },
  );
  await expect(warning).toBeVisible();
  const alert = page.getByRole("alert").filter({ has: warning });
  await expect(alert.locator("details")).not.toHaveAttribute("open", "");
  await expect(ask).toHaveText("Unsent initial question");
  // Nothing opens: New session stays, and the earlier session is still listed as it was.
  await expect(page).toHaveURL(/#\/new$/);
  await expect(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("link", { name: seed, exact: true }),
  ).toBeVisible();
  expect(oldId).toBeTruthy();
  expect(commands).toEqual(["create"]);
  const history = await (
    await request.get(`/api/sessions/${createdId}/items`)
  ).json();
  expect(history.items).toEqual([]);
  expect(history.more).toBe(false);
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1200 });
    await page.screenshot({
      path: info.outputPath(`create-settlement-${width}.png`),
      fullPage: true,
    });
  }
  await alert.getByText("Details", { exact: true }).click();
  await expect(alert.locator("details p")).toContainText(createdId);
});
