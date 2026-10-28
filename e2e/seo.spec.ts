import { expect, test } from "@playwright/test";

test("initial HTML and share URLs expose the intended indexing signals", async ({
  page,
}) => {
  const response = await page.goto("./");
  if (!response) throw new Error("The initial document response is missing.");
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain('<meta name="referrer" content="no-referrer"');
  expect(html).toContain("<h1>Try Ruby in your browser</h1>");
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).toContain('property="og:title" content="Ruby Playground"');
  expect(html).toContain('name="twitter:card" content="summary"');
  expect(html).toContain("No installation or account required.");
  const staticCode = await page.evaluate(
    (source) =>
      new DOMParser()
        .parseFromString(source, "text/html")
        .querySelector("#static-description code")?.textContent,
    html,
  );
  expect(staticCode).toBe("Hello Ruby!");
  expect(html).toMatch(
    /<link\s+rel="canonical"\s+href="https:\/\/ruby-play\.dev\/"\s*\/>/,
  );
  await expect(page).toHaveTitle(
    "Ruby Playground – Run Ruby Online in Your Browser",
  );
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("#root h1")).toHaveText("Ruby Playground");
  const socialMetadata = await page
    .locator('meta[property^="og:"], meta[name^="twitter:"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("content") ?? ""),
    );
  expect(socialMetadata).toHaveLength(7);
  expect(socialMetadata.join(" ")).not.toMatch(/[?&](?:c|v|f)=/);
  await expect(page.locator("h2", { hasText: "Editor" })).toHaveCount(1);

  await page.goto("?c=&v=4.0&f=console");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex",
  );
  await page.goto("./");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("examples open runnable code with the documented output", async ({
  page,
}) => {
  await page.goto("/examples/");
  const examples = await page.locator("main section").evaluateAll((sections) =>
    sections.map((section) => ({
      url: section.querySelector("a")!.getAttribute("href")!,
      output: section.querySelectorAll("pre")[1].textContent!.trim(),
    })),
  );
  expect(examples).toHaveLength(5);
  for (const example of examples) {
    await page.goto(example.url);
    await expect(page.getByRole("status")).toHaveText("Complete", {
      timeout: 60000,
    });
    await expect(
      page.getByRole("region", { name: "Output", exact: true }),
    ).toContainText(example.output);
  }
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ruby Playground FAQ" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/seo-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/seo-mobile.png",
    fullPage: true,
  });
});
