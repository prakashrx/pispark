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
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", {
      name: "Resource configuration: Test-only deterministic",
    }),
  ).toBeVisible();
  await ask.fill("hold alpha");
  await ask.press("Enter");
  await expect(page.getByText("partial-local", { exact: true })).toBeVisible();
  const a = await page.evaluate(() => localStorage.getItem("pispark-session"));
  const reply = page.getByRole("textbox", { name: "Reply to session" });
  await reply.fill("Draft A");
  await ask.fill("hold beta");
  await ask.press("Enter");
  await expect(ask).toHaveValue("");
  const b = await page.evaluate(() => localStorage.getItem("pispark-session"));
  expect(b).not.toBe(a);
  await expect(reply).toHaveValue("");
  await reply.fill("Draft B");
  await page.getByRole("link", { name: new RegExp(a!.slice(0, 8)) }).click();
  await expect(reply).toHaveValue("Draft A");
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
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByText("partial-local", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel and clear queue" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^idle$/ }),
  ).toBeVisible();
  const peer = await (await request.get(`/api/sessions/${b}/window`)).json();
  expect(peer.status).toBe("running");
  await reply.fill("read:sample.txt");
  await reply.press("Enter");
  await expect(
    page.getByText(/local:.*native browser tool result/),
  ).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("native-session.png") });
  await page.getByRole("link", { name: new RegExp(b!.slice(0, 8)) }).click();
  await expect(reply).toHaveValue("Draft B");
  await page.getByRole("button", { name: "Cancel and clear queue" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^idle$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("hold beta", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /^idle$/ }),
  ).toBeVisible();
});

test("native extension failure is visible and browser never receives arbitrary RPC or credentials", async ({
  page,
}) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", {
      name: "Resource configuration: Test-only deterministic",
    }),
  ).toBeVisible();
  await ask.fill("ui-confirm");
  await ask.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Session error: extension" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reply", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});

for (const mode of ["ask", "reply"] as const) {
  test(`${mode}: delayed acceptance preserves newer draft revision, including edited away and back`, async ({
    page,
  }) => {
    await page.goto("/");
    const ask = page.getByRole("textbox", {
      name: "Ask anything",
      exact: true,
    });
    await expect(
      page.getByRole("button", {
        name: "Resource configuration: Test-only deterministic",
      }),
    ).toBeVisible();
    if (mode === "reply") {
      await ask.fill("seed");
      await ask.press("Enter");
      await expect(page.getByText("local:seed", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: /^idle$/ }),
      ).toBeVisible();
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
    await expect(input).toHaveValue("submitted");
  });
}

test("background receipt failure stays with its originating session across selection changes", async ({
  page,
}) => {
  await page.goto("/");
  const ask = page.getByRole("textbox", { name: "Ask anything", exact: true });
  await expect(
    page.getByRole("button", {
      name: "Resource configuration: Test-only deterministic",
    }),
  ).toBeVisible();
  await ask.fill("session B");
  await ask.press("Enter");
  await expect(
    page.getByText("local:session B", { exact: true }),
  ).toBeVisible();
  const b = await page.evaluate(() => localStorage.getItem("pispark-session"));
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
  await ask.fill("provider-error");
  await ask.press("Enter");
  await entering;
  const a = await page.evaluate(() => localStorage.getItem("pispark-session"));
  await page.getByRole("link", { name: new RegExp(b!.slice(0, 8)) }).click();
  release();
  await expect(
    page.getByText("local:session B", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: /execution/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: new RegExp(a!.slice(0, 8)) }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /execution \(/ }),
  ).toBeVisible();
});

for (const fail of [false, true]) {
  test(`reply ${fail ? "failure" : "acceptance"} after selection change preserves both session drafts`, async ({
    page,
  }) => {
    await page.goto("/");
    const ask = page.getByRole("textbox", {
      name: "Ask anything",
      exact: true,
    });
    const reply = page.getByRole("textbox", { name: "Reply to session" });
    await expect(
      page.getByRole("button", {
        name: "Resource configuration: Test-only deterministic",
      }),
    ).toBeVisible();
    await ask.fill("switch B");
    await ask.press("Enter");
    await expect(
      page.getByText("local:switch B", { exact: true }),
    ).toBeVisible();
    const b = await page.evaluate(() =>
      localStorage.getItem("pispark-session"),
    );
    await reply.fill("B unsent");
    await ask.fill("switch A");
    await ask.press("Enter");
    await expect(
      page.getByText("local:switch A", { exact: true }),
    ).toBeVisible();
    const a = await page.evaluate(() =>
      localStorage.getItem("pispark-session"),
    );
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
    await page.getByRole("link", { name: new RegExp(b!.slice(0, 8)) }).click();
    release();
    await expect(reply).toHaveValue("B unsent");
    await expect(
      page.getByRole("button", { name: "Run", exact: true }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("alert").filter({ hasText: /busy/ }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: new RegExp(a!.slice(0, 8)) }).click();
    await expect(reply).toHaveValue("A newer unsent");
    if (fail)
      await expect(
        page.getByRole("alert").filter({ hasText: /Acceptance unknown/ }),
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
    const ask = page.getByRole("textbox", {
      name: "Ask anything",
      exact: true,
    });
    await expect(
      page.getByRole("button", {
        name: "Resource configuration: Test-only deterministic",
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
    await ask.fill("new draft during start");
    release();
    if (fail)
      await expect(
        page.getByRole("alert").filter({ hasText: /Acceptance unknown/ }),
      ).toBeVisible();
    else
      await expect(
        page.getByText("local:start delay", { exact: true }),
      ).toBeVisible();
    await expect(ask).toHaveValue("new draft during start");
  });
}

test("configuration/connectivity failures remain explicitly global, not selected-session errors", async ({
  page,
}) => {
  await page.route("**/api/catalog", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "configuration" }),
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText(
    "Workspace: Backend unavailable. Drafts have not been sent.",
  );
});
