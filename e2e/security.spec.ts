import { expect, test } from "@playwright/test";
import LZString from "lz-string";
import { editRuby, expectRubyOutput } from "./editor";
import {
  expectSharedCodePending,
  observeRubyWorkers,
  SHARED_CODE_CONSENT,
} from "./shared-code";

test("imported code cannot start a Ruby Worker before consent, including edits, version changes, reload and history navigation", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const source = 'puts "shared #{RUBY_VERSION}"';
  const url = new URL(testInfo.project.use.baseURL as string);
  url.searchParams.set("c", LZString.compressToEncodedURIComponent(source));
  url.searchParams.set("v", "3.4");
  url.searchParams.set("f", "console");
  const sharedUrl = url.toString();
  const rubyWorkers = observeRubyWorkers(page);
  await page.goto(sharedUrl);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    source,
  );
  await expectSharedCodePending(page, rubyWorkers, 0);

  await editRuby(page, 'puts "edited before consent #{RUBY_VERSION}"');
  await expectSharedCodePending(page, rubyWorkers, 0);
  await page.getByLabel("Ruby バージョン").selectOption("3.3");
  await expectSharedCodePending(page, rubyWorkers, 0);

  await page.reload();
  await expect(page.getByLabel("Ruby バージョン")).toHaveValue("3.4");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    source,
  );
  await expectSharedCodePending(page, rubyWorkers, 0);

  await page.getByRole("button", { name: SHARED_CODE_CONSENT }).click();
  await expectRubyOutput(page, /^shared 3\.4\.\d+\n$/);
  await expect(
    page.getByRole("button", { name: SHARED_CODE_CONSENT }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(実行|再実行)$/ }),
  ).toHaveCount(0);

  await editRuby(page, 'puts "after consent #{RUBY_VERSION}"');
  await expectRubyOutput(page, /^after consent 3\.4\.\d+\n$/);
  await page.getByLabel("Ruby バージョン").selectOption("3.3");
  await expectRubyOutput(page, /^after consent 3\.3\.\d+\n$/);
  // Sharing the current trusted editor state does not re-gate that state.
  await page.getByRole("button", { name: "URL を共有" }).click();
  const editedSharedUrl = await page
    .getByRole("textbox", { name: "共有 URL" })
    .inputValue();
  await expect(page.getByRole("status")).toHaveText("完了");
  await expect(
    page.getByRole("button", { name: SHARED_CODE_CONSENT }),
  ).toHaveCount(0);

  const previousWorkerCount = rubyWorkers.length;
  await page.goBack();
  await expect(page).toHaveURL(sharedUrl);
  await expect(page.getByLabel("Ruby バージョン")).toHaveValue("3.4");
  await expectSharedCodePending(page, rubyWorkers, previousWorkerCount);
  await page.getByRole("button", { name: SHARED_CODE_CONSENT }).click();
  await expectRubyOutput(page, /^shared 3\.4\.\d+\n$/);

  const trustedWorkerCount = rubyWorkers.length;
  await page.goForward();
  await expect(page).toHaveURL(editedSharedUrl);
  await expect(page.getByLabel("Ruby バージョン")).toHaveValue("3.3");
  await expectSharedCodePending(page, rubyWorkers, trustedWorkerCount);
  await page.getByRole("button", { name: "サンプルに戻す" }).click();
  await expectRubyOutput(page, "Hello, Ruby!\nRuby 1\nRuby 2\nRuby 3\n");
  await expect(
    page.getByRole("button", { name: SHARED_CODE_CONSENT }),
  ).toHaveCount(0);
  await editRuby(page, 'puts "reset remains live"');
  await expectRubyOutput(page, "reset remains live\n");
});

test("empty or invalid shared-code parameters still require consent before the fallback sample runs", async ({
  page,
}, testInfo) => {
  const rubyWorkers = observeRubyWorkers(page);
  for (const compressed of ["", "not-valid-compressed-code"]) {
    const url = new URL(testInfo.project.use.baseURL as string);
    url.searchParams.set("c", compressed);
    await page.goto(url.toString());
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Shared code is invalid",
    );
    await expectSharedCodePending(page, rubyWorkers, 0);
  }
});

test("static safety, privacy and license pages resolve without third-party scripts", async ({
  page,
  request,
}, testInfo) => {
  const externalRequests: string[] = [];
  const appOrigin = new URL(testInfo.project.use.baseURL as string).origin;
  page.on("request", (resource) => {
    if (new URL(resource.url()).origin !== appOrigin) {
      externalRequests.push(resource.url());
    }
  });
  await page.goto("./");
  const routes = [
    ["./safety.html", "安全な利用"],
    ["./privacy.html", "プライバシー"],
    ["./licenses/", "ライセンス"],
  ] as const;

  for (const [route, heading] of routes) {
    const response = await request.get(new URL(route, page.url()).toString());
    expect(response.status()).toBe(200);
    await page.goto(route);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
      "content",
      "no-referrer",
    );
  }

  await page.goto("./licenses/");
  const licenseFiles = [
    ["./PROJECT-LICENSE", "Apache License"],
    ["./PROJECT-NOTICE", "Ruby Playground environment"],
    ["./THIRD-PARTY-NOTICES.txt", "monaco-editor@0.57.0"],
    ["./ruby-wasm-LICENSE", "MIT License"],
    ["./ruby-wasm-NOTICE", "Notices for ruby.wasm"],
  ] as const;
  for (const [route, requiredText] of licenseFiles) {
    const response = await request.get(new URL(route, page.url()).toString());
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(requiredText);
  }
  await expect(
    page.getByRole("link", { name: "配布JavaScript依存のライセンス" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "配布JavaScript依存のライセンス" })
    .click();
  await expect(page.locator("body")).toContainText("monaco-editor@0.57.0");

  expect(externalRequests).toEqual([]);
});
