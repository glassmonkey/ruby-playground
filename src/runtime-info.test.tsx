import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import RuntimeInfoPanel from "./runtime-info";
import type { RuntimeInfo } from "./runtime";

afterEach(cleanup);

it.each([
  {
    version: "4.0.0",
    platform: "wasm32-wasi",
    encoding: "UTF-8",
    releaseDate: "2025-12-25",
    revision: "553f1675f3",
  },
  {
    version: "3.3.3",
    platform: "wasm32-wasi",
    encoding: "UTF-8",
    releaseDate: "2024-06-12",
    revision: "f1c7b6f435",
  },
] satisfies RuntimeInfo[])(
  "shows the reported Ruby $version environment",
  (info) => {
    // Act
    render(
      <ChakraProvider>
        <RuntimeInfoPanel info={info} />
      </ChakraProvider>,
    );
    // Assert
    const region = screen.getByRole("region", {
      name: "Ruby runtime environment",
    });
    expect({
      title: screen.getByRole("heading", { level: 2 }).textContent,
      busy: region.getAttribute("aria-busy"),
      facts: Array.from(region.querySelectorAll("dt")).map((label) => [
        label.textContent,
        label.nextElementSibling?.textContent,
      ]),
    }).toEqual({
      title: `Ruby ${info.version}`,
      busy: "false",
      facts: [
        ["Platform", info.platform],
        ["Encoding", info.encoding],
        ["Released", info.releaseDate],
        ["Revision", info.revision],
      ],
    });
  },
);

it("stops indicating loading when the VM could not provide metadata", () => {
  // Act
  render(
    <ChakraProvider>
      <RuntimeInfoPanel isLoading={false} />
    </ChakraProvider>,
  );
  // Assert
  expect({
    busy: screen
      .getByRole("region", { name: "Ruby runtime environment" })
      .getAttribute("aria-busy"),
    title: screen.getByRole("heading", { level: 2 }).textContent,
  }).toEqual({ busy: "false", title: "Ruby —" });
});

it("abbreviates the revision while preserving the full value", () => {
  // Arrange
  const revision = "553f1675f3a9cece340b90f374a4245dccac2272";
  // Act
  render(
    <ChakraProvider>
      <RuntimeInfoPanel
        info={{
          version: "4.0.0",
          platform: "wasm32-wasi",
          encoding: "UTF-8",
          releaseDate: "2025-12-25",
          revision,
        }}
      />
    </ChakraProvider>,
  );
  // Assert
  expect(screen.getByTitle(revision).textContent).toBe("553f1675f3");
});
