import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import App, { INITIAL_CODE } from "./app";

afterEach(cleanup);
const setup = () =>
  render(
    <ChakraProvider>
      <App />
    </ChakraProvider>,
  );
describe("setup preview", () => {
  it("clearly marks execution as unavailable", () => {
    setup();
    expect(
      screen.getByRole("heading", { name: "Ruby Playground" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "実行（準備中）",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("allows an empty editor and resets repeatedly", () => {
    setup();
    const editor = screen.getByRole("textbox", {
      name: "Ruby source",
    }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "" } });
    expect(editor.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "サンプルに戻す" }));
    fireEvent.click(screen.getByRole("button", { name: "サンプルに戻す" }));
    expect(editor.value).toBe(INITIAL_CODE);
  });
});
