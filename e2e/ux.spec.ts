import LZString from "lz-string";
import { expect, test } from "@playwright/test";
import { expectDocumentToFitViewport } from "./layout";
import {
  editRuby as edit,
  expectRubyOutput,
  expectInitialRuby,
  INITIAL_OUTPUT,
} from "./editor";

test("runtime information stays separate from initial and edited console output", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("./");
  await expectInitialRuby(page);
  const info = page.getByRole("region", { name: "Ruby runtime environment" });
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 4.0.0",
  );
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "def fractal(rows, depth)",
  );
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "puts fractal(%w[Hello Ruby!], 3)",
  );
  await page.screenshot({
    path: testInfo.outputPath("initial-light.png"),
    fullPage: true,
  });
  await page.getByText("UI Theme:", { exact: true }).click();
  await expect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("initial-dark.png"),
    fullPage: true,
  });
  await page.getByText("UI Theme:", { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectDocumentToFitViewport(page, 390);
  const consoleOutput = page.getByTestId("preview-console");
  await expect
    .poll(() =>
      consoleOutput.evaluate((element) => ({
        whitespace: getComputedStyle(element).whiteSpace,
        scrolls: element.scrollWidth > element.clientWidth,
      })),
    )
    .toEqual({ whitespace: "pre", scrolls: true });
  await consoleOutput.hover();
  await page.mouse.wheel(300, 0);
  await expect
    .poll(() => consoleOutput.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await consoleOutput.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.screenshot({
    path: testInfo.outputPath("initial-mobile.png"),
    fullPage: true,
  });
  await page.getByLabel("Ruby version").selectOption("3.3");
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.3.3",
  );
  await page.reload();
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.3.3",
  );
  await edit(page, "puts RUBY_DESCRIPTION # plain text");
  await expectRubyOutput(page, /^ruby 3\.3\.3 .*\[wasm32-wasi\]\n$/);
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.3.3",
  );
  await expect(
    page
      .getByRole("region", { name: "Output" })
      .getByRole("region", { name: "Ruby runtime environment" }),
  ).toHaveCount(0);
  await edit(page, 'puts "ruby 9.9.9 (2000-01-01 revision deadbeef) [spoof]"');
  await expectRubyOutput(
    page,
    "ruby 9.9.9 (2000-01-01 revision deadbeef) [spoof]\n",
  );
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.3.3",
  );
  await edit(page, 'raise "test error"');
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "test error",
  );
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.3.3",
  );
});

test("environment info arrives even when a shared script never finishes", async ({
  page,
}) => {
  await page.goto(
    `./?v=3.4&c=${encodeURIComponent(LZString.compressToEncodedURIComponent("loop {}"))}`,
  );
  const info = page.getByRole("region", { name: "Ruby runtime environment" });
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.4.1",
    { timeout: 10_000 },
  );
  await expect(page.getByRole("status")).toContainText("Running");
  await expect(page.getByTestId("preview-console")).toHaveText("");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "stopped",
  );
  await expect(info.getByRole("heading", { level: 2 })).toHaveText(
    "Ruby 3.4.1",
  );
});

test("theme controls preserve edits across layouts and reloads", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./");
  const themeSwitch = page.getByRole("checkbox", { name: "Light theme" });
  await expect(themeSwitch).toBeChecked();
  await expect(page.getByText("Dark", { exact: true })).toBeVisible();
  await expect(page.getByText("Light", { exact: true })).toBeVisible();
  await edit(page, 'puts "<h1>Ruby preview</h1>"');
  await expectRubyOutput(page, "<h1>Ruby preview</h1>\n");

  await page.getByText("UI Theme:", { exact: true }).click();
  await expect(themeSwitch).not.toBeChecked();
  await expect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  await expectRubyOutput(page, "<h1>Ruby preview</h1>\n");
  await page.reload();
  await expect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  await expectRubyOutput(page, "<h1>Ruby preview</h1>\n");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "HTML Preview" }),
  ).toHaveCount(0);

  const editor = page.getByRole("region", { name: "Editor" });
  const output = page.getByRole("region", { name: "Output" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(async () => {
      const left = await editor.boundingBox();
      const right = await output.boundingBox();
      return (
        !!left && !!right && right.x > left.x && Math.abs(right.y - left.y) < 1
      );
    })
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("desktop-dark.png"),
    fullPage: true,
  });

  await page.getByText("UI Theme:", { exact: true }).click();
  await expect(themeSwitch).toBeChecked();
  await expect(page.locator(".monaco-editor.vs")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desktop-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectDocumentToFitViewport(page, 390);
  await expect
    .poll(async () => {
      const top = await editor.boundingBox();
      const bottom = await output.boundingBox();
      return !!top && !!bottom && bottom.y >= top.y + top.height;
    })
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile-light.png"),
    fullPage: true,
  });
});

test("address bar saves Unicode and empty source without adding history entries", async ({
  page,
}) => {
  await page.goto("./?campaign=ruby#about");
  await expectInitialRuby(page);
  const historyLength = await page.evaluate(() => history.length);
  for (const code of ['puts "こんにちは + & # 😀"', ""]) {
    await edit(page, code);
    await expectRubyOutput(page, code ? "こんにちは + & # 😀\n" : "");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    const url = new URL(page.url());
    expect(url.searchParams.get("campaign")).toBe("ruby");
    expect(url.hash).toBe("#about");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
    await page.reload();
    await expectRubyOutput(page, code ? "こんにちは + & # 😀\n" : "");
    await expect(page.getByLabel("Running", { exact: true })).toHaveCount(0);
  }
});

test("keyboard order, labelled work areas and narrow layouts remain usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const navigationStartedAt = Date.now();
  await page.goto("./");
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();

  const editorReadyElapsedMs = Date.now() - navigationStartedAt;
  const navigationTiming = await page.evaluate(() => {
    const entry = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    return {
      domContentLoadedMs: entry.domContentLoadedEventEnd,
      loadEventMs: entry.loadEventEnd,
    };
  });
  await testInfo.attach("local-ux-timings.json", {
    body: JSON.stringify(
      {
        preview: "local production preview",
        viewport: "1280x900 CSS px",
        browser: testInfo.project.name,
        cache: "current browser profile; not controlled by this test",
        editorReadyElapsedMs,
        ...navigationTiming,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Editor" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Output" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Legal and contact" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Donate", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Ruby version")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: "Light theme", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: /^(Run|Rerun)$/ })).toHaveCount(
    0,
  );

  await expectInitialRuby(page);
  await page.locator(".monaco-editor .view-lines").click();
  await expect(
    page.getByRole("textbox", { name: "Ruby source" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("region", { name: "Output" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Ruby code examples" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "issue on GitHub" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Privacy Policy" }),
  ).toBeFocused();

  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectDocumentToFitViewport(page, width);
    const selector = page.getByLabel("Ruby version");
    await expect(selector).toBeVisible();
    const bounds = await selector.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await selector.selectOption("3.3");
    await expect(selector).toHaveValue("3.3");
  }

  await edit(page, 'puts "mobile #{RUBY_VERSION}"');
  await expectRubyOutput(page, /^mobile 3\.3\.\d+\n$/);
  await expectDocumentToFitViewport(page, 320);

  expect(
    await page
      .getByRole("link", { name: "Privacy Policy" })
      .getAttribute("href"),
  ).toBe("./privacy.html");
  expect(
    await page.getByRole("link", { name: "Contact" }).getAttribute("href"),
  ).toBe("https://twitter.com/glassmonekey");
  expect(
    await page
      .getByRole("link", { name: "License", exact: true })
      .getAttribute("href"),
  ).toBe("https://github.com/glassmonkey/ruby-playground/blob/main/LICENSE");

  await expect(page.getByRole("button", { name: "Reset sample" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Share URL" })).toHaveCount(0);
  const url = page.url();
  expect(new URL(url).searchParams.get("v")).toBe("3.3");
  await page.reload();
  await expectRubyOutput(page, /^mobile 3\.3\.\d+\n$/);
});

test("records fresh low-speed first-run outcome, stop and recovery timings", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (512 * 1024) / 8,
    latency: 100,
    connectionType: "cellular3g",
  });

  let entryChunkHeld = false;
  let continueEntryChunk!: () => void;
  const entryChunkContinued = new Promise<void>((resolve) => {
    continueEntryChunk = resolve;
  });
  await page.route(/\/index-[^/]+\.js$/, async (route) => {
    entryChunkHeld = true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
    continueEntryChunk();
  });
  let firstRubyWorkerStartedAt: number | undefined;
  page.on("worker", (worker) => {
    if (
      worker.url().includes("ruby-worker") &&
      firstRubyWorkerStartedAt === undefined
    ) {
      firstRubyWorkerStartedAt = Date.now();
    }
  });
  const navigationStartedAt = Date.now();
  const navigation = page.goto("./", { waitUntil: "commit" });
  const staticHeading = page.locator("#static-description h1");
  await expect(staticHeading).toHaveText("Try Ruby in your browser", {
    timeout: 20_000,
  });
  const staticDescriptionVisibleMs = Date.now() - navigationStartedAt;
  expect(entryChunkHeld).toBe(true);
  await navigation;
  // Observe completion concurrently: editor loading must not inflate run duration.
  const coldRunFinishedAt = expect(page.getByRole("status"))
    .toHaveText(/^(Complete|Error)$/, { timeout: 90_000 })
    .then(() => Date.now());
  await entryChunkContinued;
  await page.waitForLoadState("load");
  await page.unroute(/\/index-[^/]+\.js$/);
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({
    timeout: 60_000,
  });
  const editorReadyMs = Date.now() - navigationStartedAt;

  // The initial sample now starts automatically, before the editor is ready.
  await expect.poll(() => firstRubyWorkerStartedAt).toBeDefined();
  const coldRunStartedAt = firstRubyWorkerStartedAt!;
  const coldRunElapsedMs = (await coldRunFinishedAt) - coldRunStartedAt;
  const coldRunStatus = (await page.getByRole("status").innerText()).trim();
  const coldRunError = (
    await page.getByRole("main").getByRole("alert").allTextContents()
  ).join("\n");
  const coldRunOutput = await page.getByTestId("preview-console").innerText();

  if (coldRunStatus === "Complete") {
    expect(
      coldRunOutput
        .trimEnd()
        .split("\n")
        .map((row) => row.trimEnd())
        .join("\n"),
    ).toBe(INITIAL_OUTPUT);
    expect(coldRunError).toBe("");
  } else {
    expect(coldRunError).toContain("timed out");
    expect(coldRunOutput).toBe("");
  }

  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
    connectionType: "wifi",
  });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await edit(page, "loop {}");
  await expect(page.getByRole("status")).toContainText("Running", {
    timeout: 10_000,
  });
  await page.waitForTimeout(5000);
  const stopStartedAt = Date.now();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "stopped",
  );
  const stopElapsedMs = Date.now() - stopStartedAt;

  const recoveryStartedAt = Date.now();
  await edit(page, 'puts "recovered"');
  await expectRubyOutput(page, "recovered\n");
  const recoveryRunElapsedMs = Date.now() - recoveryStartedAt;

  const warmRunStartedAt = Date.now();
  await edit(page, 'puts "warm"');
  await expectRubyOutput(page, "warm\n");
  const warmRunElapsedMs = Date.now() - warmRunStartedAt;

  const measurements = {
    environment: "local production preview; Chromium; 1280x900 CSS px",
    browserPlatform: await page.evaluate(() => navigator.platform),
    cache:
      "fresh context; disabled for cold 4 Mbps / 100 ms run; enabled for recovery and warm run",
    throttle: "4 Mbps down, 512 Kbps up, 100 ms latency",
    staticDescriptionVisibleMs,
    entryChunkHeldForMs: 1500,
    editorReadyMs,
    coldRunTrigger:
      "initial automatic run; measured from actual Ruby Worker creation",
    editedRunTiming:
      "from starting the edit through verified output; includes 350 ms debounce",
    coldRunElapsedMs,
    coldRunStatus,
    coldRunError,
    coldRunOutput,
    stopElapsedMs,
    recoveryRunElapsedMs,
    warmRunElapsedMs,
  };
  console.log("UX_PERFORMANCE_METRICS", JSON.stringify(measurements));
  await testInfo.attach("local-cold-warm-performance.json", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
});
