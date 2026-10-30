import { afterEach, describe, expect, it } from "vitest";
import { hasShareParameters, syncRobotsMeta } from "../indexing";

describe("shared URL indexing policy", () => {
  afterEach(() => {
    document.head
      .querySelectorAll("meta[data-share-noindex]")
      .forEach((meta) => meta.remove());
    window.history.replaceState(null, "", "/");
  });

  it.each(["?c=", "?v=4.0", "?f=html", "?theme=dark&c=payload"])(
    "detects presence of share parameter in %s",
    (search) => {
      expect(hasShareParameters(search)).toBe(true);
    },
  );

  it.each(["", "?theme=dark", "?campaign=share"])(
    "leaves ordinary query %s indexable",
    (search) => {
      expect(hasShareParameters(search)).toBe(false);
    },
  );

  it.each(["pushState", "replaceState"] as const)(
    "updates indexing after %s without a popstate event",
    (method) => {
      // Act
      window.history[method](null, "", "/?c=payload");
      // Assert
      expect(
        document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
      ).toBe("noindex");
      // Act
      window.history[method](null, "", "/");
      // Assert
      expect(document.querySelector('meta[name="robots"]')).toBeNull();
    },
  );

  it("adds noindex for a shared URL and removes it on the normal route", () => {
    syncRobotsMeta("?c=payload");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content,
    ).toBe("noindex");

    syncRobotsMeta("");
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });
});
