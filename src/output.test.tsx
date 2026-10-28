import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import Output from "./output";

afterEach(cleanup);

it.each([
  {
    text: "ruby 4.0.0 (2025-12-25 revision 553f1675f3) +PRISM [wasm32-wasi]\n",
  },
  { text: "<h1>Hello</h1><script>alert(1)</script>" },
  { text: "unexpected runtime output" },
  { text: "" },
])("preserves console output for $text", ({ text }) => {
  // Act
  const { container } = render(
    <ChakraProvider>
      <Output text={text} />
    </ChakraProvider>,
  );
  // Assert
  expect({
    output: screen.getByTestId("preview-console").textContent,
    regions: screen.queryAllByRole("region", { name: "Ruby の実行環境" })
      .length,
    embeddedMarkup: container.querySelectorAll("iframe, script, h1").length,
  }).toEqual({ output: text, regions: 0, embeddedMarkup: 0 });
});
