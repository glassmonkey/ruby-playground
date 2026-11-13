import { expect, type Page } from "@playwright/test";

export const INITIAL_OUTPUT = [
  "                                ruby",
  "                                ruby",
  "rubyruby        ruby    ruby    rubyruby        ruby    ruby",
  "ruby    ruby    ruby    ruby    ruby    ruby    ruby    ruby",
  "ruby            ruby    ruby    ruby    ruby        rubyruby",
  "ruby            ruby    ruby    ruby    ruby            ruby",
  "ruby                rubyruby    rubyruby        rubyruby",
].join("\n");

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

/** Compare each rendered Monaco line, preserving line boundaries and spaces. */
export async function expectEditorSource(page: Page, source: string) {
  const expectedLines = source.split("\n");
  const renderedLines = page.locator(".monaco-editor .view-line");
  await expect(renderedLines).toHaveCount(expectedLines.length);
  await expect
    .poll(async () =>
      renderedLines.evaluateAll((lines) =>
        lines.map((line) => (line.textContent ?? "").replace(/\u00a0/g, " ")),
      ),
    )
    .toEqual(expectedLines);
}

/** Check new output first so a prior run's completed status cannot satisfy us. */
export async function expectRubyOutput(page: Page, output: string | RegExp) {
  await expect(page.getByTestId("preview-console")).toHaveText(output, {
    timeout: 30_000,
  });
  await expectRubyExecutionStatus(page, "Complete");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
}

export async function expectRubyExecutionStatus(
  page: Page,
  status: "Complete" | "Error",
) {
  const outputRegion = page.getByRole("region", { name: "Output" });
  await expect(outputRegion.getByRole("status")).toHaveText(status);
  await expect(
    page.getByRole("status", { name: /^Code completion status:/ }),
  ).toBeVisible();
}

/** Initial source stays plain console output; environment data is independent. */
export async function expectInitialRuby(page: Page) {
  await expect(
    page.getByRole("region", { name: "Ruby runtime environment" }),
  ).toContainText("wasm32-wasi", { timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const output = await page.getByTestId("preview-console").textContent();
        return output
          ?.trimEnd()
          .split("\n")
          .map((row) => row.trimEnd())
          .join("\n");
      },
      { timeout: 30_000 },
    )
    .toBe(INITIAL_OUTPUT);
  await expectRubyExecutionStatus(page, "Complete");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
}
