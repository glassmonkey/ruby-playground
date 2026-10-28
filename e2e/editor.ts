import { expect, type Page } from "@playwright/test";

/** Edit through Monaco's accessible input, just as a keyboard user would. */
export async function editRuby(page: Page, code: string) {
  const editor = page.getByRole("textbox", { name: "Ruby source" });
  await page.locator(".monaco-editor .view-lines").click({ timeout: 10_000 });
  await expect(editor).toBeFocused();
  const selectAll = await page.evaluate(() =>
    navigator.userAgent.includes("Macintosh") ? "Meta+A" : "Control+A",
  );
  await page.keyboard.press(selectAll);
  if (code) await page.keyboard.insertText(code);
  else await page.keyboard.press("Backspace");
  if (code) {
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      code.split("\n")[0],
    );
  }
}

/** Check new output first so a prior run's completed status cannot satisfy us. */
export async function expectRubyOutput(page: Page, output: string | RegExp) {
  await expect(page.getByTestId("preview-console")).toHaveText(output, {
    timeout: 30_000,
  });
  await expect(page.getByRole("status")).toHaveText("完了");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
}
