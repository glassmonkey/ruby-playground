import LZString from "lz-string";
import { expect, test, type Page } from "@playwright/test";
import { codeOnlyUrl, editRuby } from "./editor";

const directRubyGemsRequests = new WeakMap<Page, string[]>();

const gemfile = 'gem "rainbow", "3.1.1"\n';
const sharedLock = "rainbow 3.1.1";
const rainbowCode =
  "require 'rainbow'; Rainbow.enabled = false; puts Rainbow('rainbow ready').green";
const rainbowGemFile = "/gems/rainbow-3.1.1.gem";
const artiiGemFile = "/gems/artii-2.1.2.gem";
const proxyOrigin = new URL(
  process.env.GEM_PROXY_TEST_URL ?? "http://127.0.0.1:8787",
).origin;
const POSTER_OUTPUT = String.raw`+-----------------------------+
|     ____        __          |
|    / __ \__  __/ /_  __  __ |
|   / /_/ / / / / __ \/ / / / |
|  / _, _/ /_/ / /_/ / /_/ /  |
| /_/ |_|\__,_/_.___/\__, /   |
|                   /____/    |
|                             |
| Made with Ruby + gems       |
+-----------------------------+
`;

type VcrFault = {
  path: string;
  kind: "not-found" | "corrupt" | "delay";
  delayMs?: number;
};

function sharedUrl(code: string, options: { gemfile: string; lock?: string }) {
  const params = new URLSearchParams({
    c: LZString.compressToEncodedURIComponent(code),
    g: LZString.compressToEncodedURIComponent(options.gemfile),
  });
  if (options.lock)
    params.set("l", LZString.compressToEncodedURIComponent(options.lock));
  return `./?${params.toString()}`;
}

async function editGemfile(
  page: import("@playwright/test").Page,
  value: string,
) {
  await page.getByRole("tab", { name: "Gemfile" }).click();
  await editRuby(page, value, "Gemfile source");
}

async function expectInstallComplete(page: import("@playwright/test").Page) {
  await expect(
    page.getByText("Gemfile.lock matches the Gemfile.", { exact: false }),
  ).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
}

async function resetRubyGemsVcr() {
  const response = await fetch("http://127.0.0.1:18787/__reset", {
    method: "POST",
  });

  expect(response.status).toBe(200);
}

async function faultRubyGemsVcr(fault: VcrFault) {
  const response = await fetch("http://127.0.0.1:18787/__faults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fault),
  });

  expect(response.status).toBe(201);
}

test.beforeEach(async ({ page }) => {
  await resetRubyGemsVcr();
  const requests: string[] = [];
  directRubyGemsRequests.set(page, requests);
  await page.route("https://rubygems.org/**", async (route) => {
    requests.push(route.request().url());
    await route.abort("blockedbyclient");
  });
});

test.afterEach(({ page }) => {
  expect(directRubyGemsRequests.get(page)).toEqual([]);
});

async function expectEditorTabContrast(
  page: Page,
  selectedName: "Source" | "Gemfile",
) {
  const tabs = await page.getByRole("tab").evaluateAll((elements) => {
    const luminance = (color: string) => {
      const channels = color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (!channels || channels.length !== 3)
        throw new Error("Unable to parse a computed tab color.");
      const linear = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };

    return elements.map((element) => {
      const style = getComputedStyle(element);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return {
        name: element.textContent?.trim(),
        selected: element.getAttribute("aria-selected") === "true",
        ratio:
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05),
      };
    });
  });

  expect(tabs.map(({ name }) => name)).toEqual(["Source", "Gemfile"]);
  expect(
    tabs.filter(({ selected }) => selected).map(({ name }) => name),
  ).toEqual([selectedName]);
  for (const tab of tabs) expect(tab.ratio).toBeGreaterThanOrEqual(4.5);
}

test("bare entry installs artii and renders the Poster with accessible tabs", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const proxyRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === proxyOrigin) proxyRequests.push(url.pathname);
  });

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("./?campaign=ruby#poster");
  await expect(page.getByTestId("preview-console")).toHaveText(POSTER_OUTPUT, {
    timeout: 120_000,
  });
  await expect(page.getByRole("status")).toHaveText("Complete");
  expect(new URL(page.url()).search).toBe("?campaign=ruby");
  expect(new URL(page.url()).hash).toBe("#poster");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  expect(proxyRequests).toEqual(["/info/artii", artiiGemFile]);

  await page.getByRole("tab", { name: "Gemfile", exact: true }).click();
  await expectInstallComplete(page);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    'gem "artii", "= 2.1.2"',
  );
  await page.getByRole("tab", { name: "Source", exact: true }).click();

  await expect(
    page.getByRole("region", { name: "Ruby runtime environment" }),
  ).toContainText("wasm32-wasi", { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expectEditorTabContrast(page, "Source");
  await page.screenshot({
    path: testInfo.outputPath("poster-tabs-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  const sourceTab = page.getByRole("tab", { name: "Source", exact: true });
  const gemfileTab = page.getByRole("tab", { name: "Gemfile", exact: true });
  await sourceTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(gemfileTab).toBeFocused();
  await expectEditorTabContrast(page, "Gemfile");
  await expect(
    page.getByRole("textbox", { name: "Gemfile source" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(sourceTab).toHaveAttribute("aria-selected", "true");

  await page.getByText("UI Theme:", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectEditorTabContrast(page, "Source");
  await page.screenshot({
    path: testInfo.outputPath("poster-tabs-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await sourceTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(gemfileTab).toHaveAttribute("aria-selected", "true");
  await expectEditorTabContrast(page, "Gemfile");
  await page.keyboard.press("ArrowLeft");
  await expect(sourceTab).toHaveAttribute("aria-selected", "true");
});

test("missing require guidance opens Gemfile and bundle install makes the gem available", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const proxyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === proxyOrigin)
      proxyRequests.push(new URL(request.url()).pathname);
  });

  await page.goto(codeOnlyUrl(""));
  await editRuby(page, rainbowCode);
  await expect(
    page.getByText('Could not load "rainbow".', { exact: false }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Open Gemfile" }).click();
  await editGemfile(page, gemfile);
  await page.getByRole("button", { name: "bundle install" }).click();
  await expectInstallComplete(page);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\n",
    {
      timeout: 120_000,
    },
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(proxyRequests).toContain("/info/rainbow");
  expect(proxyRequests).toContain(rainbowGemFile);
});

test("recovers from a missing gem response and installs a valid Gemfile", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const proxyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === proxyOrigin)
      proxyRequests.push(new URL(request.url()).pathname);
  });
  await page.goto(codeOnlyUrl(""));
  await editRuby(page, rainbowCode);
  await expect(
    page.getByText('Could not load "rainbow".', { exact: false }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Open Gemfile" }).click();
  await editGemfile(page, gemfile);
  await faultRubyGemsVcr({ path: "/info/rainbow", kind: "not-found" });
  await page.getByRole("button", { name: "bundle install" }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: "bundle install failed:" }),
  ).toContainText('gem "rainbow" was not found on rubygems.org.');
  expect(proxyRequests).toContain("/info/rainbow");

  await resetRubyGemsVcr();
  await page.getByRole("button", { name: "bundle install" }).click();
  await expectInstallComplete(page);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\n",
    {
      timeout: 120_000,
    },
  );
});

test("reports a corrupt gem archive, avoids caching it, and recovers", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const proxyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === proxyOrigin)
      proxyRequests.push(new URL(request.url()).pathname);
  });
  await page.goto(codeOnlyUrl(""));
  await editRuby(page, rainbowCode);
  await expect(
    page.getByText('Could not load "rainbow".', { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open Gemfile" }).click();
  await editGemfile(page, gemfile);
  await faultRubyGemsVcr({ path: rainbowGemFile, kind: "corrupt" });
  await page.getByRole("button", { name: "bundle install" }).click();
  await expect(
    page
      .getByRole("main")
      .getByRole("alert")
      .filter({ hasText: "bundle install failed:" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gemfile.lock", exact: true }),
  ).toHaveCount(0);
  expect(proxyRequests).toContain(rainbowGemFile);
  const corruptGemCached = await page.evaluate(async ({ gemFile, origin }) => {
    const cache = await caches.open("ruby-playground-gems-v1");
    const cached = await cache.match(new URL(gemFile, origin).toString());
    return cached !== undefined;
  }, { gemFile: rainbowGemFile, origin: proxyOrigin });
  expect(corruptGemCached).toBe(false);

  await resetRubyGemsVcr();
  await page.getByRole("button", { name: "bundle install" }).click();
  await expectInstallComplete(page);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\n",
    {
      timeout: 120_000,
    },
  );
});

test("stops a delayed install, then recovers and reruns with the gem", async ({
  page,
}) => {
  test.setTimeout(180_000);
  let resolveRequest!: () => void;
  const delayedRequest = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  let metadataRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === proxyOrigin && url.pathname === "/info/rainbow") {
      metadataRequests++;
      resolveRequest();
    }
  });

  await page.goto(codeOnlyUrl(""));
  await editRuby(page, 'puts "previous output"');
  await expect(page.getByTestId("preview-console")).toHaveText(
    "previous output\n",
  );
  await editGemfile(page, gemfile);
  await faultRubyGemsVcr({
    path: "/info/rainbow",
    kind: "delay",
    delayMs: 10_000,
  });
  await page.getByRole("button", { name: "bundle install" }).click();
  await delayedRequest;
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(
    page.getByRole("button", { name: "bundle install" }),
  ).toBeVisible();
  await expect(
    page.getByText("No Gemfile.lock yet. Press bundle install."),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("preview-console")).toHaveText(
    "previous output\n",
  );

  await page.getByRole("tab", { name: "Gemfile" }).click();
  await resetRubyGemsVcr();
  await page.getByRole("button", { name: "bundle install" }).click();
  await expectInstallComplete(page);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await editRuby(page, rainbowCode);
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\n",
    { timeout: 120_000 },
  );
  expect(metadataRequests).toBe(2);
});

test("adds a gem to an installed Gemfile and reruns edited code with it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const proxyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === proxyOrigin)
      proxyRequests.push(new URL(request.url()).pathname);
  });
  await page.goto(
    sharedUrl(rainbowCode, {
      gemfile,
      lock: sharedLock,
    }),
  );
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\n",
    {
      timeout: 120_000,
    },
  );

  await editGemfile(page, `${gemfile}gem "pastel", "0.8.0"\n`);
  await page.getByRole("button", { name: "bundle install" }).click();
  await expectInstallComplete(page);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await editRuby(
    page,
    "require 'rainbow'; require 'pastel'; Rainbow.enabled = false; puts Rainbow('rainbow ready').green; puts Pastel.new(enabled: false).green('pastel ready'); puts \"#{Pastel::VERSION} #{TTY::Color::VERSION}\"",
  );
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\npastel ready\n0.8.0 0.6.0\n",
    { timeout: 120_000 },
  );
  expect(proxyRequests).toContain("/info/pastel");
  expect(proxyRequests).toContain("/info/tty-color");
  expect(proxyRequests).toContain("/gems/pastel-0.8.0.gem");
  expect(proxyRequests).toContain("/gems/tty-color-0.6.0.gem");
});

test("a shared URL with Gemfile and lock runs the locked gem", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const code = rainbowCode;
  const proxyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin === proxyOrigin)
      proxyRequests.push(new URL(request.url()).pathname);
  });
  await page.goto(sharedUrl(code, { gemfile, lock: sharedLock }));
  await expect(page.getByTestId("preview-console")).toHaveText(
    "rainbow ready\n",
    {
      timeout: 120_000,
    },
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  expect(proxyRequests).not.toContain("/info/rainbow");
  expect(proxyRequests).toContain(rainbowGemFile);
});

test("a shared Gemfile without a lock automatically resolves and runs", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const code = rainbowCode;
  await page.goto(sharedUrl(code, { gemfile }));
  await expect(page.getByTestId("preview-console")).toContainText(
    "rainbow ready",
    {
      timeout: 180_000,
    },
  );
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.has("l"), {
      timeout: 120_000,
    })
    .toBe(true);
});

test("editing Gemfile marks its lock stale and keeps the previous output", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(
    sharedUrl('puts "previous output"', { gemfile, lock: sharedLock }),
  );
  await expect(page.getByTestId("preview-console")).toHaveText(
    "previous output\n",
    {
      timeout: 120_000,
    },
  );
  await editGemfile(page, `${gemfile}gem "pastel", "0.8.0"\n`);
  await expect(
    page.getByText("Gemfile.lock (out of date)", { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.has("l")).toBe(false);
  await page.getByRole("tab", { name: "Source", exact: true }).click();
  await expect(page.getByTestId("preview-console")).toHaveText(
    "previous output\n",
  );
});
