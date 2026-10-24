import { expect, type Page } from "@playwright/test";

export async function expectDocumentToFitViewport(
  page: Page,
  viewportWidth: number,
) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const width = window.innerWidth;
          const scrollWidth = document.documentElement.scrollWidth;
          const overflowing = Array.from(document.querySelectorAll("body *"))
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName,
                className:
                  typeof element.className === "string"
                    ? element.className
                    : "",
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              };
            })
            .filter((element) => element.right > width + 1);

          return {
            viewportWidth: width,
            scrollWidth,
            fits: scrollWidth <= width,
            overflowing,
          };
        }),
      {
        message: `document should fit the ${viewportWidth}px viewport after resize`,
        timeout: 5_000,
      },
    )
    .toMatchObject({ viewportWidth, fits: true });
}
