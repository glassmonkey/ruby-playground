import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import App, { INITIAL_CODE } from "./app";
vi.mock("./editor", () => ({
  default: ({
    code,
    onChange,
  }: {
    code: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Ruby source"
      value={code}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
const start = vi.hoisted(() =>
  vi.fn(() => ({
    promise: Promise.resolve({ stdout: "", stderr: "", output: "" }),
    cancel: vi.fn(),
  })),
);
vi.mock("./workers/client", () => ({ startRubyRun: start }));
afterEach(() => {
  cleanup();
  start.mockClear();
  window.history.replaceState(null, "", "/");
});
const setup = () =>
  render(
    <ChakraProvider>
      <App />
    </ChakraProvider>,
  );
describe("playground UI", () => {
  it("does not auto-run shared or initial code and accepts empty edits", async () => {
    setup();
    const editor = (await screen.findByRole("textbox", {
      name: "Ruby source",
    })) as HTMLTextAreaElement;
    expect(start).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "実行" }));
    await screen.findByText("出力なし");
    expect(start).toHaveBeenCalledWith("");
  });
  it("resets repeatedly and preserves editable initial code", async () => {
    setup();
    const editor = (await screen.findByRole("textbox", {
      name: "Ruby source",
    })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "puts 42" } });
    fireEvent.click(screen.getByRole("button", { name: "サンプルに戻す" }));
    fireEvent.click(screen.getByRole("button", { name: "サンプルに戻す" }));
    expect(editor.value).toBe(INITIAL_CODE);
  });
  it("shares without executing and restores state on back navigation", async () => {
    setup();
    const editor = (await screen.findByRole("textbox", {
      name: "Ruby source",
    })) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "puts 42" } });
    fireEvent.click(screen.getByRole("button", { name: "URL を共有" }));
    expect(
      (
        (await screen.findByRole("textbox", {
          name: "共有 URL",
        })) as HTMLInputElement
      ).value,
    ).toContain("c=");
    expect(start).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(editor.value).toBe(INITIAL_CODE);
  });
});
