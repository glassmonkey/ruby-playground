import { expect, test } from "@playwright/test";
import { expectDocumentToFitViewport } from "./layout";

async function edit(page: import("@playwright/test").Page, code: string) {
  const editor = page.getByRole("textbox", { name: "Ruby source" });
  await page.locator(".monaco-editor .view-lines").click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(code);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    code.split("\n")[0],
  );
}

test("keyboard order, labelled work areas and narrow layouts remain usable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const navigationStartedAt = Date.now();
  await page.goto("./");
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    "低速回線では初回の Ruby 読み込みがタイムアウトすることがあります。通信環境を変えて再実行してください。",
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

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "実行", exact: true }),
  ).toBeFocused();

  await page.locator(".monaco-editor .view-lines").click();
  await expect(
    page.getByRole("textbox", { name: "Ruby source" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "安全な利用" })).toBeFocused();

  for (const width of [640, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectDocumentToFitViewport(page, width);
  }

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
  const navigationStartedAt = Date.now();
  const navigation = page.goto("./", { waitUntil: "commit" });
  const staticHeading = page.locator("#static-description h1");
  await expect(staticHeading).toHaveText("ブラウザで Ruby を試す", {
    timeout: 20_000,
  });
  const staticDescriptionVisibleMs = Date.now() - navigationStartedAt;
  expect(entryChunkHeld).toBe(true);
  await navigation;
  await entryChunkContinued;
  await page.waitForLoadState("load");
  await page.unroute(/\/index-[^/]+\.js$/);
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible({
    timeout: 60_000,
  });
  const editorReadyMs = Date.now() - navigationStartedAt;

  await edit(page, 'puts "cold"');
  const coldRunStartedAt = Date.now();
  await page.getByRole("button", { name: "実行", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/^(完了|エラー)$/, {
    timeout: 26_000,
  });
  const coldRunElapsedMs = Date.now() - coldRunStartedAt;
  const coldRunStatus = (await page.getByRole("status").innerText()).trim();
  const coldRunError = await page
    .getByRole("main")
    .getByRole("alert")
    .innerText()
    .catch(() => "");
  const coldRunOutput = await page
    .getByTestId("preview-console")
    .innerText()
    .catch(() => "");

  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
    connectionType: "wifi",
  });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await edit(page, "loop {}");
  await page.getByRole("button", { name: "実行", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("実行中", {
    timeout: 10_000,
  });
  await page.waitForTimeout(5000);
  const stopStartedAt = Date.now();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("停止");
  const stopElapsedMs = Date.now() - stopStartedAt;

  await edit(page, 'puts "recovered"');
  const recoveryStartedAt = Date.now();
  await page.getByRole("button", { name: "実行", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("完了", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("preview-console")).toHaveText("recovered\n");
  const recoveryRunElapsedMs = Date.now() - recoveryStartedAt;

  await edit(page, 'puts "warm"');
  const warmRunStartedAt = Date.now();
  await page.getByRole("button", { name: "実行", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("完了", {
    timeout: 10_000,
  });
  await expect(page.getByTestId("preview-console")).toHaveText("warm\n");
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
