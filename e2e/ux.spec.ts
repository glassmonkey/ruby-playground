import { expect, test } from "@playwright/test";
import { expectDocumentToFitViewport } from "./layout";
import { editRuby as edit, expectRubyOutput } from "./editor";

test("theme and preview controls preserve edits across layouts and reloads", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./");
  await edit(page, 'puts "<h1>Ruby preview</h1>"');
  await expectRubyOutput(page, "<h1>Ruby preview</h1>\n");

  await page.getByText("UI Theme:", { exact: true }).click();
  await expect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  await expectRubyOutput(page, "<h1>Ruby preview</h1>\n");
  await page.getByText("HTML Preview", { exact: true }).click();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Ruby preview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "URL を共有" }).click();
  await page.reload();
  await expect(page.locator(".monaco-editor.vs-dark")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "HTML Preview" }),
  ).toBeChecked();
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Ruby preview" }),
  ).toBeVisible();
  await page.getByText("HTML Preview", { exact: true }).click();
  await expectRubyOutput(page, "<h1>Ruby preview</h1>\n");

  const editor = page.getByRole("region", { name: "エディター" });
  const output = page.getByRole("region", { name: "出力" });
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

test("keyboard order, labelled work areas and narrow layouts remain usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const navigationStartedAt = Date.now();
  await page.goto("./");
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "低速回線では初回の Ruby 読み込みがタイムアウトすることがあります。通信環境を変え、コードを編集するかバージョンを変更してください。",
  );
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
  await expect(page.getByRole("region", { name: "エディター" })).toBeVisible();
  await expect(page.getByRole("region", { name: "出力" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "安全と情報" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Donate", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Ruby バージョン")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: "UI Theme", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: "HTML Preview" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: /^(実行|再実行)$/ }),
  ).toHaveCount(0);

  await page.locator(".monaco-editor .view-lines").click();
  await expect(
    page.getByRole("textbox", { name: "Ruby source" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "安全な利用" })).toBeFocused();

  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectDocumentToFitViewport(page, width);
    const selector = page.getByLabel("Ruby バージョン");
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
    await page.getByRole("link", { name: "安全な利用" }).getAttribute("href"),
  ).toBe("./safety.html");
  expect(
    await page.getByRole("link", { name: "プライバシー" }).getAttribute("href"),
  ).toBe("./privacy.html");
  expect(
    await page.getByRole("link", { name: "ライセンス" }).getAttribute("href"),
  ).toBe("./licenses/");

  const appOrigin = new URL(page.url()).origin;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: appOrigin,
  });
  await page.evaluate(() => {
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Clipboard unavailable", "NotAllowedError");
        },
        readText: clipboard.readText.bind(clipboard),
      },
    });
  });
  await page.getByRole("button", { name: "URL を共有" }).click();
  const sharedUrl = page.getByRole("textbox", { name: "共有 URL" });
  await expect(sharedUrl).toHaveValue(/^http/);
  await sharedUrl.focus();
  const selectedCharacters = await sharedUrl.evaluate((element) => {
    const input = element as HTMLInputElement;
    return input.selectionEnd! - input.selectionStart!;
  });
  expect(selectedCharacters).toBe(
    await sharedUrl.evaluate(
      (element) => (element as HTMLInputElement).value.length,
    ),
  );
  const copyShortcut = await page.evaluate(() =>
    navigator.platform.startsWith("Mac") ? "Meta+C" : "Control+C",
  );
  await page.keyboard.press(copyShortcut);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(await sharedUrl.inputValue());
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
  await expect(staticHeading).toHaveText("ブラウザで Ruby を試す", {
    timeout: 20_000,
  });
  const staticDescriptionVisibleMs = Date.now() - navigationStartedAt;
  expect(entryChunkHeld).toBe(true);
  await navigation;
  // Observe completion concurrently: editor loading must not inflate run duration.
  const coldRunFinishedAt = expect(page.getByRole("status"))
    .toHaveText(/^(完了|エラー)$/, { timeout: 90_000 })
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
  const coldRunOutput = await page
    .getByTestId("preview-console")
    .innerText()
    .catch(() => "");

  if (coldRunStatus === "完了") {
    expect(coldRunOutput.trim()).toBe("Hello, Ruby!\nRuby 1\nRuby 2\nRuby 3");
    expect(coldRunError).toBe("");
  } else {
    expect(coldRunError).toContain("タイムアウト");
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
  await expect(page.getByRole("status")).toContainText("実行中", {
    timeout: 10_000,
  });
  await page.waitForTimeout(5000);
  const stopStartedAt = Date.now();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("停止");
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
