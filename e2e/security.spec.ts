import { expect, test } from "@playwright/test";

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
    ["./safety.html", "Security"],
    ["./privacy.html", "Privacy Policy"],
    ["./licenses/", "Licenses"],
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
    ["./ruby-wasm-LICENSE", "MIT License"],
    ["./ruby-wasm-NOTICE", "Notices for ruby.wasm"],
  ] as const;
  for (const [route, requiredText] of licenseFiles) {
    const response = await request.get(new URL(route, page.url()).toString());
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(requiredText);
  }
  expect(externalRequests).toEqual([]);
});
