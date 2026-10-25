import { expect, type Page } from "@playwright/test";

export const SHARED_CODE_CONSENT = "共有コードを信頼して有効にする";

/** Observe actual Ruby Workers, not Monaco's unrelated editor Worker. */
export function observeRubyWorkers(page: Page): string[] {
  const workers: string[] = [];
  page.on("worker", (worker) => {
    if (worker.url().includes("ruby-worker")) workers.push(worker.url());
  });
  return workers;
}

/** Wait beyond the live debounce so a missing consent gate cannot pass silently. */
export async function expectSharedCodePending(
  page: Page,
  workers: string[],
  expectedWorkerCount: number,
) {
  await expect(page.getByRole("status")).toHaveText("共有コードの確認待ち");
  await expect(
    page.getByRole("button", { name: SHARED_CODE_CONSENT, exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(750);
  expect(
    workers,
    "No Ruby Worker may start before shared-code consent",
  ).toHaveLength(expectedWorkerCount);
  await expect(page.getByRole("status")).toHaveText("共有コードの確認待ち");
  await expect(
    page.getByRole("button", { name: "停止", exact: true }),
  ).toHaveCount(0);
  if ((await page.getByLabel("出力形式").inputValue()) === "html") {
    await expect(page.frameLocator("iframe").locator("body")).toHaveText("");
  } else {
    await expect(page.getByTestId("preview-console")).toHaveText("");
  }
}
