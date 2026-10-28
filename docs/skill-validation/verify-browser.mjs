import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import lz from "lz-string";
import { RUBY_RELEASES as versions } from "../../src/versions.ts";
const lesson = JSON.parse(readFileSync("content/tutorial.json")).find(
  (x) => x.slug === "inheritance",
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const results = [];
for (const { id } of versions) {
  await page.goto(`http://127.0.0.1:18930/tutorial/${id}/inheritance/`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    lesson.title,
  );
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  await expect(editor).toHaveValue(lesson.code);
  await page.getByRole("button", { name: "Run code", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Complete", {
    timeout: 30000,
  });
  await expect(page.getByTestId("lesson-output")).toHaveText(
    lesson.output + "\n",
  );
  const exercise = lesson.code.replace(
    '"#{super} (#{@level})"',
    '"ALERT: #{super} (#{@level})"',
  );
  await editor.fill(exercise);
  await page.getByRole("button", { name: "Run code", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Complete", {
    timeout: 30000,
  });
  await expect(page.getByTestId("lesson-output")).toHaveText(
    "ALERT: Message: Check the door (urgent)\n",
  );
  const href = await page
    .getByRole("link", { name: "Continue in full Playground" })
    .getAttribute("href");
  const url = new URL(href);
  expect(url.searchParams.get("v")).toBe(id);
  expect(lz.decompressFromEncodedURIComponent(url.searchParams.get("c"))).toBe(
    exercise,
  );
  await page.getByRole("checkbox", { name: "Light theme" }).uncheck();
  await expect(editor).toHaveValue(exercise);
  await editor.fill("puts RUBY_VERSION");
  await page.getByRole("button", { name: "Run code", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Complete");
  results.push({
    version: id,
    rubyVersion: (await page.getByTestId("lesson-output").textContent()).trim(),
    starter: "pass",
    exercise: "pass",
    handoff: "pass",
    themePreservesEdits: "pass",
  });
}
await page.goto("http://127.0.0.1:18930/tutorial/4.0/inheritance/");
await expect(
  page.locator('.course-sidebar [aria-current="page"]'),
).toHaveAttribute("href", "/tutorial/4.0/inheritance/");
await page.evaluate(() => scrollTo(0, 0));
await page.screenshot({
  path: "/tmp/ruby-skill-inheritance-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await expect(page.locator(".course-sidebar nav")).toBeHidden();
expect(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
).toBe(true);
await page.screenshot({
  path: "/tmp/ruby-skill-inheritance-mobile.png",
  fullPage: true,
});
const nojs = await browser.newContext({ javaScriptEnabled: false });
const staticPage = await nojs.newPage();
await staticPage.goto("http://127.0.0.1:18930/tutorial/4.0/inheritance/");
await expect(staticPage.getByRole("heading", { level: 1 })).toHaveText(
  lesson.title,
);
writeFileSync(
  "browser-evidence.json",
  JSON.stringify(
    { results, mobile: "pass", withoutJavaScript: "pass" },
    null,
    2,
  ),
);
console.log(JSON.stringify(results));
await browser.close();
