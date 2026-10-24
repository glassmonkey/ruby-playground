import { expect, test, type Page } from "@playwright/test";
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
async function edit(page: Page, code: string) {
  const editor = page.getByRole("textbox", { name: "Ruby source" });
  await page.locator(".monaco-editor .view-lines").click({ timeout: 10_000 });
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(code);
}
async function run(page: Page) {
  await page.getByRole("button", { name: "実行", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/^(完了|エラー)$/, {
    timeout: 30_000,
  });
}
test("real Ruby output, errors, empty runs and VM reset", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ruby Playground" }),
  ).toBeVisible();
  await edit(page, 'puts "こんにちは"; warn "warning"; $answer = 42');
  await run(page);
  await expect(page.getByTestId("preview-console")).toHaveText(
    "こんにちは\nwarning\n",
  );
  await edit(page, 'puts defined?($answer).inspect; raise "boom"');
  await run(page);
  await expect(page.getByTestId("preview-console")).toHaveText("nil\n");
  await expect(
    page.getByRole("main").getByRole("alert"),
  ).toContainText("boom");
  await edit(page, "1 + 2");
  await run(page);
  await expect(page.getByText("出力なし", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("alert"),
  ).toHaveCount(0);
  await edit(page, "def broken(");
  await run(page);
  await expect(
    page.getByRole("main").getByRole("alert"),
  ).toContainText("SyntaxError");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("share round trip requires explicit run and HTML remains sandboxed", async ({
  page,
}) => {
  await page.goto("/");
  await edit(
    page,
    'puts %q{<h1>Hello HTML</h1><script>parent.document.title="unsafe"</script>}',
  );
  await page.getByLabel("出力形式").selectOption("html");
  await page.getByRole("button", { name: "URL を共有" }).click();
  const url = await page
    .getByRole("textbox", { name: "共有 URL" })
    .inputValue();
  await page.goto(url);
  await expect(page.getByRole("status")).toHaveText("実行待ち");
  await expect(page.getByLabel("出力形式")).toHaveValue("html");
  await run(page);
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Hello HTML" }),
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveAttribute("sandbox", "");
  await expect(page).toHaveTitle("Ruby Playground");
});
test("cancel an infinite run and successfully rerun", async ({ page }) => {
  await page.goto("/");
  await edit(page, "loop {}");
  await page.getByRole("button", { name: "実行", exact: true }).click();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect(
    page.getByRole("main").getByRole("alert"),
  ).toContainText("停止");
  await edit(page, 'puts "recovered"');
  await run(page);
  await expect(page.getByTestId("preview-console")).toHaveText("recovered\n");
});
