import { expect, test } from "@playwright/test";
import lessons from "../content/tutorial.json" with { type: "json" };

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

for (const [index, lesson] of lessons.entries()) {
  test(`tutorial: ${lesson.slug} teaches and runs the documented program`, async ({
    page,
    context,
  }) => {
    await page.goto(`/tutorial/${lesson.slug}/`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      lesson.title,
    );
    await expect(page.locator(".expected-output")).toHaveText(lesson.output);
    const feedback = page.locator("details p");
    await expect(feedback).toBeHidden();
    await page.getByText("Check your understanding", { exact: true }).click();
    await expect(feedback).toHaveText(lesson.answer);
    const popup = context.waitForEvent("page");
    await page
      .getByRole("link", { name: "Run this lesson in Playground" })
      .click();
    const runner = await popup;
    await expect(runner.getByRole("status")).toHaveText("Complete", {
      timeout: 60000,
    });
    await expect(runner.getByTestId("preview-console")).toHaveText(
      lesson.output + "\n",
    );
    await runner.close();
    const navigation = page.getByRole("navigation", {
      name: "Lesson navigation",
    });
    if (index + 1 < lessons.length) {
      await navigation
        .getByRole("link", { name: lessons[index + 1].title })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        lessons[index + 1].title,
      );
    } else {
      await navigation
        .getByRole("link", { name: "Choose what to explore next" })
        .click();
      await expect(page).toHaveURL(/\/tutorial\/#coverage$/);
    }
  });
}

test("tutorial is discoverable, readable without JavaScript and usable on mobile", async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const link = page
      .getByRole("banner")
      .getByRole("link", { name: "Start Ruby tutorial" });
    await expect(link).toBeInViewport();
    await link.click();
    await expect(page).toHaveURL(/\/tutorial\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ruby Tutorial",
    );
    await expect(
      page.getByRole("navigation", { name: "Course contents" }).locator("li"),
    ).toHaveCount(lessons.length);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/tutorial-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "Start learning Ruby", exact: true })
      .click();
    await expect(page).toHaveURL(/\/tutorial\/output\/$/);
    await page.screenshot({
      path: `test-results/lesson-${width}.png`,
      fullPage: true,
    });
  }
  const response = await page.request.get("/tutorial/output/");
  expect(await response.text()).toContain("Your first Ruby program");
  await page.goto("/examples/");
  await expect(page).toHaveURL(/\/tutorial\/$/);
});
