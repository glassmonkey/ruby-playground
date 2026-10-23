import { expect, test } from "@playwright/test";

test("production setup shell loads and resets without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ruby Playground" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "実行（準備中）" }),
  ).toBeDisabled();
  const editor = page.getByRole("textbox", { name: "Ruby source" });
  await editor.fill("");
  await page.getByRole("button", { name: "サンプルに戻す" }).click();
  await expect(editor).toHaveValue('puts "Hello, Ruby!"\n');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(editor).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
