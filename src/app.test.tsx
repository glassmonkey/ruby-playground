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
  it("labels editor and output sections and links to the safety pages", () => {
    setup();
    expect(screen.getByRole("region", { name: "エディター" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "出力" })).toBeTruthy();
    const navigation = screen.getByRole("navigation", { name: "安全と情報" });
    expect(
      Array.from(navigation.querySelectorAll("a")).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["安全な利用", "./safety.html"],
      ["プライバシー", "./privacy.html"],
      ["ライセンス", "./licenses/"],
    ]);
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
  it("keeps editor content and reports when the complete share URL is too long", async () => {
    setup();
    const editor = (await screen.findByRole("textbox", {
      name: "Ruby source",
    })) as HTMLTextAreaElement;
    let seed = 7;
    let code = "";
    const alphabet =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    for (let i = 0; i < 8_000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      code += alphabet[seed % alphabet.length];
    }
    fireEvent.change(editor, { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "URL を共有" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "共有 URL が長すぎます。コードを短くしてから再度共有してください。",
    );
    expect(editor.value).toBe(code);
    expect(screen.queryByRole("textbox", { name: "共有 URL" })).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });
});
