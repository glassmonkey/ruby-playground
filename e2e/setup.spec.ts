import { expect, test } from "@playwright/test";
import { RUBY_PATCH_VERSIONS } from "../src/versions";
import { editRuby as edit, expectRubyOutput } from "./editor";
import { expectDocumentToFitViewport } from "./layout";
test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) =>
    console.error("Browser page error:", error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("Browser console:", message.text());
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    console.error(
      "Failed page:",
      await page
        .locator("body")
        .innerText({ timeout: 2000 })
        .catch(() => "unavailable"),
    );
});
test("initial and edited Ruby automatically execute with errors, empty output and fresh VMs", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const requests: Array<{ url: string; type: string }> = [];
  page.on("request", (request) => {
    requests.push({ url: request.url(), type: request.resourceType() });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Ruby Playground" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^(実行|再実行)$/ }),
  ).toHaveCount(0);
  await expectRubyOutput(page, "Hello, Ruby!\nRuby 1\nRuby 2\nRuby 3\n");
  await edit(page, 'puts "こんにちは"; warn "warning"; $answer = 42');
  await expectRubyOutput(page, "こんにちは\nwarning\n");
  await page.screenshot({
    path: testInfo.outputPath("ruby-output.png"),
    fullPage: true,
  });
  await edit(page, 'puts defined?($answer).inspect; raise "boom"');
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "boom",
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByRole("status")).toHaveText("エラー");
  await expect(page.getByTestId("preview-console")).toHaveText("nil\n");
  await edit(page, "1 + 2");
  await expect(page.getByText("出力なし", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("status")).toHaveText("完了");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await edit(page, "def broken(");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "SyntaxError",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("status")).toHaveText("エラー");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectDocumentToFitViewport(page, 390);
  const appBase = new URL(testInfo.project.use.baseURL as string).pathname;
  const appOrigin = new URL(testInfo.project.use.baseURL as string).origin;
  const httpRequests = requests.filter(({ url }) => {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  });
  const sameOriginRequests = httpRequests.filter(
    ({ url }) => new URL(url).origin === appOrigin,
  );
  await testInfo.attach("browser-network-requests.json", {
    body: JSON.stringify(
      {
        requests,
        nonHttpUrls: requests
          .filter(({ url }) => !/^https?:/i.test(url))
          .map(({ url, type }) => ({ url, type })),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(sameOriginRequests.length).toBeGreaterThan(0);
  expect(
    sameOriginRequests.every(({ url }) =>
      new URL(url).pathname.startsWith(appBase),
    ),
  ).toBe(true);
  const appResources = sameOriginRequests.map(({ url }) => url);
  expect(
    appResources.some((url) =>
      /\/editor-[^/]+\.js$/.test(new URL(url).pathname),
    ),
  ).toBe(true);
  expect(
    appResources.some((url) => new URL(url).pathname.includes("ruby-worker")),
  ).toBe(true);
  expect(
    appResources.some((url) => new URL(url).pathname.endsWith(".wasm")),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("shared code, version and HTML output automatically restore on direct load and reload", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("./");
  await page.getByLabel("Ruby バージョン").selectOption("3.4");
  await edit(
    page,
    'puts "<h1>Hello HTML #{RUBY_VERSION}</h1>"; puts %q{<script>parent.document.title="unsafe"</script>}',
  );
  await page.getByLabel("出力形式").selectOption("html");
  await expect(
    page
      .frameLocator("iframe")
      .getByRole("heading", { name: /^Hello HTML 3\.4\./ }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "URL を共有" }).click();
  const url = await page
    .getByRole("textbox", { name: "共有 URL" })
    .inputValue();
  expect(new URL(url).searchParams.get("v")).toBe("3.4");
  for (const navigate of [() => page.goto(url), () => page.reload()]) {
    await navigate();
    await expect(page.getByLabel("Ruby バージョン")).toHaveValue("3.4");
    await expect(page.getByLabel("出力形式")).toHaveValue("html");
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      "Hello HTML",
    );
    await expect(
      page
        .frameLocator("iframe")
        .getByRole("heading", { name: /^Hello HTML 3\.4\./ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("status")).toHaveText("完了");
    await expect(page.locator("iframe")).toHaveAttribute("sandbox", "");
    await expect(page).toHaveTitle("Ruby Playground");
  }
});

test("each selected minor version executes its own real Ruby VM", async ({
  page,
}) => {
  test.setTimeout(100_000);
  await page.goto("./");
  await edit(page, "puts RUBY_VERSION");
  const selector = page.getByLabel("Ruby バージョン");
  expect(
    await selector
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      ),
  ).toEqual(["4.0", "3.4", "3.3"]);
  for (const version of ["4.0", "3.4", "3.3", "4.0"] as const) {
    await selector.selectOption(version);
    await expectRubyOutput(page, `${RUBY_PATCH_VERSIONS[version]}\n`);
    await page.getByRole("button", { name: "URL を共有" }).click();
    const sharedUrl = await page
      .getByRole("textbox", { name: "共有 URL" })
      .inputValue();
    expect(new URL(sharedUrl).searchParams.get("v")).toBe(version);
  }
});

test("rapid edits and version changes cancel stale runs and keep only the latest result", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await expectRubyOutput(page, "Hello, Ruby!\nRuby 1\nRuby 2\nRuby 3\n");
  const oldWorkerStarted = page.waitForEvent("worker", {
    predicate: (worker) => worker.url().includes("ruby-worker"),
  });
  await edit(page, 'puts "stale result"; loop {}');
  const oldWorker = await oldWorkerStarted;
  let oldWorkerClosed = false;
  oldWorker.on("close", () => {
    oldWorkerClosed = true;
  });
  await expect(page.getByRole("status")).toContainText("実行中");

  await edit(page, 'raise "stale error"');
  await page.getByLabel("Ruby バージョン").selectOption("3.4");
  await edit(page, 'puts "latest #{RUBY_VERSION}"');
  await page.getByLabel("Ruby バージョン").selectOption("3.3");
  await expect.poll(() => oldWorkerClosed, { timeout: 5_000 }).toBe(true);
  await expectRubyOutput(page, /^latest 3\.3\.\d+\n$/);
  // Allow canceled promise handlers and any trailing debounce to settle.
  await page.waitForTimeout(1_000);
  await expectRubyOutput(page, /^latest 3\.3\.\d+\n$/);
  await expect(page.getByLabel("Ruby バージョン")).toHaveValue("3.3");
});

test("stop an infinite automatic run without restarting until the source changes", async ({
  page,
}) => {
  await page.goto("./");
  await edit(page, "loop {}");
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("停止");
  await page.waitForTimeout(700);
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("停止");
  await edit(page, 'puts "recovered"');
  await expectRubyOutput(page, "recovered\n");
});

test("an infinite automatic run times out and the next edit recovers", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("./");
  await expectRubyOutput(page, "Hello, Ruby!\nRuby 1\nRuby 2\nRuby 3\n");
  await edit(page, "loop {}");
  await expect(page.getByRole("status")).toContainText("実行中");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "タイムアウト",
    { timeout: 25_000 },
  );
  await expect(page.getByRole("status")).toHaveText("エラー");
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  await edit(page, 'puts "after timeout #{RUBY_VERSION}"');
  await expectRubyOutput(page, /^after timeout 4\.0\.\d+\n$/);
});
