import { expect, test } from "@playwright/test";

test("initial HTML and share URLs expose the intended indexing signals", async ({
  page,
}) => {
  const response = await page.goto("./");
  if (!response) throw new Error("The initial document response is missing.");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<meta name="referrer" content="no-referrer"');
  expect(html).toContain("<h1>ブラウザで Ruby を試す</h1>");
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).toContain('property="og:title" content="Ruby Playground"');
  expect(html).toContain('name="twitter:card" content="summary"');
  expect(html).toContain("標準入力、追加gem、永続保存には対応しません。");
  const staticCode = await page.evaluate(
    (source) =>
      new DOMParser()
        .parseFromString(source, "text/html")
        .querySelector("#static-description code")?.textContent,
    html,
  );
  expect(staticCode).toBe('puts "Hello, Ruby!"');
  expect(html).toMatch(
    /<link\s+rel="canonical"\s+href="https:\/\/glassmonkey\.github\.io\/ruby-playground\/"\s*\/>/,
  );
  await expect(page).toHaveTitle("Ruby Playground");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("#root h1")).toHaveText("Ruby Playground");
  const socialMetadata = await page
    .locator('meta[property^="og:"], meta[name^="twitter:"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("content") ?? ""),
    );
  expect(socialMetadata).toHaveLength(7);
  expect(socialMetadata.join(" ")).not.toMatch(/[?&](?:c|v|f)=/);
  await expect(page.locator("h2", { hasText: "エディター" })).toHaveCount(1);

  await page.goto("?c=&v=4.0&f=console");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  await page.goto("./");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});
