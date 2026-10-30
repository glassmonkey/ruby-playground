import rawLessons from "../src/tutorial/data/lessons.json" with { type: "json" };
import { expect, test } from "@playwright/test";
import {
  tutorialVersions,
  latestTutorialVersion,
  lessonsForVersion,
} from "../src/tutorial/content";
import { RUBY_PATCH_VERSIONS } from "../src/versions";
const lessons = lessonsForVersion(latestTutorialVersion);

// Membership comes from raw publication data, not the resolver under test.
function publishedSlugs(version: string): string[] {
  return rawLessons
    .filter((lesson) => {
      const variants = lesson.variants as
        Record<string, { available?: boolean }> | undefined;
      return variants?.[version]?.available !== false;
    })
    .map((lesson) => lesson.slug);
}
function publishedExperimentIds(slug: string, version: string): string[] {
  const source = rawLessons.find((item) => item.slug === slug)!;
  const variant = (
    source.variants as
      Record<string, { experiments?: { id: string }[] }> | undefined
  )?.[version];
  // A supplied variant array replaces the base; an absent array inherits it.
  return (variant?.experiments ?? source.experiments)
    .map((sample) => sample.id)
    .sort();
}
for (const version of tutorialVersions) {
  const expectedIds = publishedSlugs(version.id).sort();
  const actualIds = lessonsForVersion(version.id)
    .map((lesson) => lesson.slug)
    .sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
    throw new Error(
      `Tutorial test discovery lost catalog identities for ${version.id}`,
    );
  for (const lesson of lessonsForVersion(version.id)) {
    const expectedSamples = publishedExperimentIds(lesson.slug, version.id);
    const actualSamples = lesson.experiments.map((sample) => sample.id).sort();
    if (JSON.stringify(actualSamples) !== JSON.stringify(expectedSamples))
      throw new Error(
        `Tutorial test discovery lost experiment identities for ${version.id}/${lesson.slug}`,
      );
  }
}

for (const [alias, destination] of [
  ["latest/output", "4.0/output"],
  ["output", "4.0/output"],
  ["3.2/comments", "3.2/output"],
]) {
  test(`alias ${alias} preserves query parameters and section anchors`, async ({
    page,
  }) => {
    await page.goto(
      `/tutorial/${alias}/?utm_source=review&value=a%26b#practice`,
    );
    await expect(page).toHaveURL(
      `/tutorial/${destination}/?utm_source=review&value=a%26b#practice`,
    );
    await expect(page.locator("#practice")).toBeInViewport();
  });
}

const releasePresentationCases = [
  {
    id: "4.0",
    label: "Ruby 4.0",
    namespace: "4.0",
    lessonDescription:
      "Run a short Ruby program and choose how to display its values.",
  },
  {
    id: "3.4",
    label: "Ruby 3.4",
    namespace: "3.4",
    lessonDescription:
      "Run a short Ruby program and choose how to display its values.",
  },
  {
    id: "3.3",
    label: "Ruby 3.3",
    namespace: "3.3",
    lessonDescription:
      "Run a short Ruby program and choose how to display its values.",
  },
  {
    id: "3.2",
    label: "Ruby 3.2",
    namespace: "3.2",
    lessonDescription:
      "Run a short Ruby program and choose how to display its values.",
  },
  {
    id: "4.1",
    label: "Ruby 4.1 development",
    namespace: "master",
    lessonDescription:
      "Ruby 4.1 development: Run a short Ruby program and choose how to display its values.",
  },
];
if (
  JSON.stringify(releasePresentationCases.map((item) => item.id).sort()) !==
  JSON.stringify(tutorialVersions.map((item) => item.id).sort())
)
  throw new Error(
    "Every registered release needs explicit presentation expectations",
  );

for (const release of releasePresentationCases) {
  for (const { path, title, description, referenceUrl } of [
    {
      path: `${release.id}/`,
      title: `${release.label} Tutorial — Ruby Playground`,
      description: `Learn ${release.label} step by step with runnable examples, practice tasks, and explanations.`,
      referenceUrl: undefined,
    },
    {
      path: `${release.id}/output/`,
      title: `Run Ruby and inspect values — ${release.label} Tutorial`,
      description: release.lessonDescription,
      referenceUrl: `https://docs.ruby-lang.org/en/${release.namespace}/Kernel.html#method-i-puts`,
    },
  ]) {
    test(`search and social metadata identify the release at ${path}`, async ({
      page,
      request,
    }) => {
      const response = await request.get(`/tutorial/${path}`);
      const got = await page.evaluate(
        (html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return {
            title: doc.title,
            versionLabel: doc.querySelector(
              "#tutorial-version option[selected]",
            )?.textContent,
            referenceUrl: doc
              .querySelector('a[href*="Kernel.html#method-i-puts"]')
              ?.getAttribute("href"),
            titles: [
              ...doc.querySelectorAll(
                'meta[property="og:title"], meta[name="twitter:title"], meta[property="og:image:alt"], meta[name="twitter:image:alt"]',
              ),
            ].map((el) => el.getAttribute("content")),
            descriptions: [
              ...doc.querySelectorAll(
                'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]',
              ),
            ].map((el) => el.getAttribute("content")),
          };
        },
        await response.text(),
      );
      expect(got).toEqual({
        title,
        versionLabel: release.label,
        referenceUrl,
        titles: [title, title, title, title],
        descriptions: [description, description, description],
      });
    });
  }
}

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
  expect(staticCode).toBe("ruby");
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

for (const version of tutorialVersions) {
  const versionLessons = lessonsForVersion(version.id);
  for (const [index, lesson] of versionLessons.entries()) {
    test(`tutorial ${version.id}: ${lesson.slug} displays and runs the documented program`, async ({
      page,
    }) => {
      await page.goto(`/tutorial/${version.id}/${lesson.slug}/`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        lesson.title,
      );
      await page.getByRole("button", { name: "Run code", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Complete", {
        timeout: 25000,
      });
      await expect(page.getByTestId("lesson-output")).toHaveText(
        lesson.output + "\n",
      );
      const executedExperiments: string[] = [];
      for (const experiment of lesson.experiments) {
        await page
          .getByRole("button", {
            name: `Try ${experiment.title}`,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("textbox", { name: "Ruby code" }),
        ).toHaveValue(experiment.code);
        await expect(page.getByRole("status")).toHaveText("Ready to run");
        await page
          .getByRole("button", { name: "Run code", exact: true })
          .click();
        await expect(page.getByRole("status")).toHaveText("Complete", {
          timeout: 25000,
        });
        await expect(page.getByTestId("lesson-output")).toHaveText(
          experiment.output + "\n",
        );
        executedExperiments.push(experiment.id);
      }
      expect(executedExperiments.sort()).toEqual(
        publishedExperimentIds(lesson.slug, version.id),
      );
      const navigation = page.getByRole("navigation", {
        name: "Lesson navigation",
      });
      if (index + 1 < versionLessons.length) {
        await navigation
          .getByRole("link", { name: versionLessons[index + 1].title })
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          versionLessons[index + 1].title,
        );
      } else {
        await navigation
          .getByRole("link", { name: "Back to your learning path" })
          .click();
        await expect(page).toHaveURL(new RegExp(`/tutorial/${version.id}/$`));
      }
    });
  }
}

test("tutorial is discoverable, readable without JavaScript and usable on mobile", async ({
  page,
  browser,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const link = page
      .getByRole("banner")
      .getByRole("link", { name: "Want to learn Ruby?" });
    await expect(link).toBeInViewport();
    await link.click();
    await expect(page).toHaveURL(/\/tutorial\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Ruby Tutorial",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Course contents" })
        .locator(".lesson-card"),
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
    await expect(page).toHaveURL(
      new RegExp(`/tutorial/${latestTutorialVersion}/output/$`),
    );
    await page.screenshot({
      path: `test-results/lesson-${width}.png`,
      fullPage: true,
    });
  }
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noScript.newPage();
  await staticPage.goto("/tutorial/output/");
  await expect(staticPage.getByRole("heading", { level: 1 })).toHaveText(
    lessons[0].title,
  );
  await expect(staticPage.locator(".example-code")).toHaveText(lessons[0].code);
  await noScript.close();
  await page.goto("/examples/");
  await expect(page).toHaveURL(/\/tutorial\/$/);
});

test("embedded playground runs edits on demand and displays Ruby errors", async ({
  page,
}) => {
  test.setTimeout(90000);
  const wasmRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".wasm")) wasmRequests.push(request.url());
  });
  await page.goto("/tutorial/output/");
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  const run = page.getByRole("button", { name: "Run code", exact: true });
  await expect(editor).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(wasmRequests).toHaveLength(0);
  await editor.fill('puts "My experiment"');
  await run.click();
  await expect(page.getByTestId("lesson-output")).toHaveText("My experiment\n");
  await editor.fill('raise "Try another approach"');
  await run.click();
  await expect(page.getByRole("alert")).toContainText("Try another approach");
});

test("embedded playground stops runs on request, sample change and version change", async ({
  page,
}) => {
  await page.goto("/tutorial/4.0/output/");
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  const run = page.getByRole("button", { name: "Run code", exact: true });
  await editor.fill("loop {}");
  await run.click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Stopped — edit or run again",
  );
  await run.click();
  await page
    .getByRole("button", {
      name: `Try ${lessons[0].experiments[0].title}`,
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue(lessons[0].experiments[0].code);
  await expect(page.getByRole("status")).toHaveText("Ready to run");
  await editor.fill("loop {}");
  await run.click();
  await page.getByLabel("Ruby version", { exact: true }).selectOption("3.3");
  await expect(page).toHaveURL(/\/tutorial\/3\.3\/output\/$/);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toHaveCount(0);
});

test("full Playground receives edited code and the selected Ruby version", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.goto("/tutorial/3.3/output/");
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  const run = page.getByRole("button", { name: "Run code", exact: true });
  await editor.fill("puts RUBY_VERSION");
  await run.click();
  await expect(page.getByTestId("lesson-output")).toHaveText(
    RUBY_PATCH_VERSIONS["3.3"] + "\n",
    {
      timeout: 25000,
    },
  );
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Continue in full Playground" }).click();
  const full = await popup;
  await expect(full).toHaveURL(/v=3\.3#editor-heading$/);
  await expect(full.getByLabel("Ruby version", { exact: true })).toHaveValue(
    "3.3",
  );
  await expect(full.getByTestId("preview-console")).toHaveText(
    RUBY_PATCH_VERSIONS["3.3"] + "\n",
    {
      timeout: 25000,
    },
  );
  await full.close();
  await page.getByLabel("Ruby version", { exact: true }).selectOption("4.0");
  await editor.fill("puts RUBY_VERSION");
  await run.click();
  await expect(page.getByTestId("lesson-output")).toHaveText(
    RUBY_PATCH_VERSIONS["4.0"] + "\n",
    {
      timeout: 25000,
    },
  );
});

test("lesson editor fits desktop and mobile viewports", async ({ page }) => {
  await page.goto("/tutorial/4.0/output/");
  await expect(page.getByRole("textbox", { name: "Ruby code" })).toBeVisible();
  await page.screenshot({
    path: "test-results/tutorial-interactive-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/tutorial-interactive-mobile.png",
    fullPage: true,
  });
});

test("latest aliases and version navigation select version-specific teaching content", async ({
  page,
}) => {
  await page.goto("/tutorial/latest/enumerable/");
  await expect(page).toHaveURL(
    new RegExp(`/tutorial/${latestTutorialVersion}/enumerable/$`),
  );
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  await page
    .getByRole("button", {
      name: "Try Combine filtering and mapping",
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue(/map \{ it \* 4 \}/);
  await expect(page.locator(".version-note")).toContainText(
    "introduced in Ruby 3.4",
  );
  await page.getByLabel("Ruby version", { exact: true }).selectOption("3.2");
  await expect(page).toHaveURL(/\/tutorial\/3\.2\/enumerable\/$/);
  await page
    .getByRole("button", {
      name: "Try Combine filtering and mapping",
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue(/map \{ \|count\| count \* 4 \}/);
  await expect(page.locator(".version-note")).toContainText("does not support");
  await expect(
    page.getByRole("link", {
      name: "Official Ruby 3.2 documentation: Enumerable",
    }),
  ).toHaveAttribute(
    "href",
    "https://docs.ruby-lang.org/en/3.2/Enumerable.html",
  );
  await page.goto("/tutorial/latest/");
  await expect(page).toHaveURL(
    new RegExp(`/tutorial/${latestTutorialVersion}/$`),
  );
  await expect(page.getByLabel("Ruby version", { exact: true })).toHaveValue(
    latestTutorialVersion,
  );
});

test("header theme stays in sync across lessons, versions and full Playground", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/tutorial/4.0/output/");
  const theme = page.getByRole("checkbox", {
    name: "Light theme",
    exact: true,
  });
  await expect(theme).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("Ruby version", { exact: true })).toHaveValue(
    "4.0",
  );
  await expect(
    page.getByLabel("Ruby version", { exact: true }).locator("option"),
  ).not.toContainText(["latest"]);
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  await editor.fill('puts "Keep this edit"');
  await theme.check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(editor).toHaveValue('puts "Keep this edit"');
  await page.reload();
  await expect(theme).toBeChecked();
  await page
    .getByRole("navigation", { name: "Lesson navigation" })
    .getByRole("link", { name: lessons[1].title })
    .click();
  await expect(theme).toBeChecked();
  await page.getByLabel("Ruby version", { exact: true }).selectOption("3.2");
  await expect(page).toHaveURL(
    new RegExp(`/tutorial/3.2/${lessons[1].slug}/$`),
  );
  await expect(theme).toBeChecked();
  const popup = context.waitForEvent("page");
  await page.getByRole("link", { name: "Continue in full Playground" }).click();
  const full = await popup;
  const fullTheme = full.getByRole("checkbox", {
    name: "Light theme",
    exact: true,
  });
  await expect(fullTheme).toBeChecked();
  await full.getByText("UI Theme:", { exact: true }).click();
  await expect(fullTheme).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(theme).not.toBeChecked();
  await full.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("banner").scrollIntoViewIfNeeded();
  await expect(
    page.getByLabel("Ruby version", { exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/tutorial-header-dark-mobile.png",
    fullPage: true,
  });
});

test("mobile course menu reveals the current lesson and navigates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tutorial/4.0/output/");
  const menu = page.locator(".course-sidebar");
  await expect(menu.getByRole("navigation")).toBeHidden();
  await menu.getByText("Course contents", { exact: true }).click();
  await expect(menu.locator('[aria-current="page"]')).toHaveAttribute(
    "href",
    "/tutorial/4.0/output/",
  );
  await menu.locator('[data-lesson-link="values"]').click();
  await expect(page).toHaveURL(/\/tutorial\/4.0\/values\/$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("sample selection preserves independent edits without automatic execution", async ({
  page,
}) => {
  await page.goto("/tutorial/4.0/output/");
  const editor = page.getByRole("textbox", { name: "Ruby code" });
  await expect(
    page.getByRole("button", { name: "Example", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Example output", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Answers", { exact: true })).toHaveCount(0);
  await expect(
    page.locator("[data-progress-summary], [data-complete-lesson]"),
  ).toHaveCount(0);
  await editor.fill('puts "my example"');
  await page
    .getByRole("button", {
      name: `Try ${lessons[0].experiments[0].title}`,
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue(lessons[0].experiments[0].code);
  await expect(page.getByRole("status")).toHaveText("Ready to run");
  await expect(page.getByTestId("lesson-output")).toHaveText(
    "Run the code to see what happens.",
  );
  await editor.fill('puts "my experiment"');
  await page
    .getByRole("button", {
      name: `Try ${lessons[0].experiments[1].title}`,
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue(lessons[0].experiments[1].code);
  await page.getByRole("button", { name: "Example", exact: true }).click();
  await expect(editor).toHaveValue('puts "my example"');
  await page
    .getByRole("button", {
      name: `Try ${lessons[0].experiments[0].title}`,
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue('puts "my experiment"');
  await expect(
    page.getByRole("button", { name: /Undo|Reset|Back to example/ }),
  ).toHaveCount(0);
});

test("version selection preserves the course structure and current lesson", async ({
  page,
}) => {
  await page.goto("/tutorial/4.0/output/");
  const original = await page
    .locator(".course-sidebar [data-lesson-link]")
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("data-lesson-link")),
    );
  const chapters = await page.locator(".sidebar-chapter h3").allTextContents();
  for (const version of tutorialVersions) {
    await page
      .getByLabel("Ruby version", { exact: true })
      .selectOption(version.id);
    await expect(page).toHaveURL(
      new RegExp(`/tutorial/${version.id}/output/$`),
    );
    expect(
      await page
        .locator(".course-sidebar [data-lesson-link]")
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute("data-lesson-link")),
        ),
    ).toEqual(original);
    expect(await page.locator(".sidebar-chapter h3").allTextContents()).toEqual(
      chapters,
    );
    await expect(
      page.locator('.course-sidebar [aria-current="page"]'),
    ).toHaveAttribute("data-lesson-link", "output");
  }
});

for (const [retired, successor] of [
  ["code-layout", "output"],
  ["comments", "output"],
  ["operators", "values"],
]) {
  test(`retired ${retired} URLs keep the version and open ${successor}`, async ({
    page,
  }) => {
    for (const version of tutorialVersions) {
      await page.goto(`/tutorial/${version.id}/${retired}/`);
      await expect(page).toHaveURL(
        new RegExp(`/tutorial/${version.id}/${successor}/$`),
      );
      await expect(
        page.getByLabel("Ruby version", { exact: true }),
      ).toHaveValue(version.id);
    }
    await page.goto(`/tutorial/${retired}/`);
    await expect(page).toHaveURL(
      new RegExp(`/tutorial/${latestTutorialVersion}/${successor}/$`),
    );
    await page.goto(`/tutorial/latest/${retired}/`);
    await expect(page).toHaveURL(
      new RegExp(`/tutorial/${latestTutorialVersion}/${successor}/$`),
    );
  });
}

test("application and tutorial expose the same versions and stable default", async ({
  page,
}) => {
  await page.goto("/");
  const appSelector = page.getByLabel("Ruby version", { exact: true });
  await expect(appSelector).toBeVisible();
  const applicationDefault = await appSelector.inputValue();
  const applicationVersions = await appSelector
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value),
    );
  await page
    .getByRole("link", { name: "Want to learn Ruby?", exact: true })
    .click();
  const tutorialSelector = page.getByLabel("Ruby version", { exact: true });
  await expect(tutorialSelector).toHaveValue(applicationDefault);
  expect(
    await tutorialSelector
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      ),
  ).toEqual(applicationVersions);
  await page
    .getByRole("link", { name: "Start learning Ruby", exact: true })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/tutorial/${applicationDefault}/output/$`),
  );
});

test("sitemap is served as XML and lists canonical tutorial URLs", async ({
  page,
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(
    /(?:application|text)\/xml/,
  );
  const sitemap = await page.evaluate(
    (xml) => {
      const document = new DOMParser().parseFromString(xml, "application/xml");
      return {
        root: document.documentElement.localName,
        errors: document.querySelectorAll("parsererror").length,
        urls: Array.from(
          document.querySelectorAll("loc"),
          (node) => node.textContent,
        ),
      };
    },
    await response.text(),
  );
  const expected = [
    "https://ruby-play.dev/",
    ...tutorialVersions.flatMap((version) => [
      `https://ruby-play.dev/tutorial/${version.id}/`,
      ...publishedSlugs(version.id).map(
        (slug) => `https://ruby-play.dev/tutorial/${version.id}/${slug}/`,
      ),
    ]),
  ];
  expect(sitemap.root).toBe("urlset");
  expect(sitemap.errors).toBe(0);
  expect(sitemap.urls.sort()).toEqual(expected.sort());
  for (const version of tutorialVersions) {
    const path = `/tutorial/${version.id}/output/`;
    const lessonResponse = await request.get(path);
    const canonicals = await page.evaluate(
      (html) =>
        Array.from(
          new DOMParser()
            .parseFromString(html, "text/html")
            .querySelectorAll('link[rel="canonical"]'),
          (node) => node.getAttribute("href"),
        ),
      await lessonResponse.text(),
    );
    expect(lessonResponse.status()).toBe(200);
    expect(canonicals).toEqual([`https://ruby-play.dev${path}`]);
  }
});

test("every tutorial article has its own canonical and a generated social PNG", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  for (const version of tutorialVersions) {
    for (const slug of [undefined, ...publishedSlugs(version.id)]) {
      const path = `/tutorial/${version.id}/${slug ? `${slug}/` : ""}`;
      const response = await request.get(path);
      expect(response.ok(), path).toBe(true);
      const metadata = await page.evaluate(
        (html) => {
          const doc = new DOMParser().parseFromString(html, "text/html");
          return {
            canonical: [...doc.querySelectorAll('link[rel="canonical"]')].map(
              (el) => el.getAttribute("href"),
            ),
            images: [...doc.querySelectorAll('meta[property="og:image"]')].map(
              (el) => el.getAttribute("content"),
            ),
            twitter: [
              ...doc.querySelectorAll('meta[name="twitter:image"]'),
            ].map((el) => el.getAttribute("content")),
            card: [...doc.querySelectorAll('meta[name="twitter:card"]')].map(
              (el) => el.getAttribute("content"),
            ),
          };
        },
        await response.text(),
      );
      expect(metadata, path).toEqual({
        canonical: [`https://ruby-play.dev${path}`],
        images: [`https://ruby-play.dev${path}og.png`],
        twitter: [`https://ruby-play.dev${path}og.png`],
        card: ["summary_large_image"],
      });
      const image = await request.get(`${path}og.png`);
      expect(image.ok()).toBe(true);
      expect(image.headers()["content-type"]).toContain("image/png");
      const png = await image.body();
      // PNG signature: https://www.w3.org/TR/png-3/#5PNG-file-signature
      const PNG_SIGNATURE = "89504e470d0a1a0a";
      expect(png.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
      const dimensions = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, png.toString("base64"));
      expect(dimensions).toEqual({ width: 1200, height: 630 });
    }
  }
});
