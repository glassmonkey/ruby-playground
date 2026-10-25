import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  it("automatically runs initial code and accepts empty edits without a Run button", async () => {
    setup();
    const editor = (await screen.findByRole("textbox", {
      name: "Ruby source",
    })) as HTMLTextAreaElement;
    expect(
      screen.queryByRole("button", { name: /^(実行|再実行)$/ }),
    ).toBeNull();
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        INITIAL_CODE,
        undefined,
        undefined,
        "4.0",
      ),
    );
    fireEvent.change(editor, { target: { value: "" } });
    await screen.findByText("出力なし");
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith("", undefined, undefined, "4.0"),
    );
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
  it("shares the current state and restores state on back navigation", async () => {
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
  });
});

it("debounces rapid edits, cancels active work, and ignores stale version results", async () => {
  const completions: Array<
    (result: { stdout: string; stderr: string; output: string }) => void
  > = [];
  const cancellations: ReturnType<typeof vi.fn>[] = [];
  start.mockImplementation(() => {
    const cancel = vi.fn();
    cancellations.push(cancel);
    return {
      cancel,
      promise: new Promise((resolve) => completions.push(resolve)),
    };
  });
  setup();
  const editor = await screen.findByRole("textbox", { name: "Ruby source" });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  fireEvent.change(editor, { target: { value: "puts :old" } });
  fireEvent.change(editor, { target: { value: "puts :latest" } });
  fireEvent.change(screen.getByLabelText("Ruby バージョン"), {
    target: { value: "3.4" },
  });
  expect(cancellations[0]).toHaveBeenCalled();
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start).toHaveBeenLastCalledWith(
    "puts :latest",
    undefined,
    undefined,
    "3.4",
  );
  await act(async () =>
    completions[1]({ stdout: "new", stderr: "", output: "new" }),
  );
  await act(async () =>
    completions[0]({ stdout: "stale", stderr: "", output: "stale" }),
  );
  expect(screen.getByTestId("preview-console").textContent).toBe("new");
  start.mockImplementation(() => ({
    promise: Promise.resolve({ stdout: "", stderr: "", output: "" }),
    cancel: vi.fn(),
  }));
});

it("requires explicit trust for imported code, edits and versions, and re-gates navigation", async () => {
  window.history.replaceState(null, "", "/?c=broken&v=3.3");
  setup();
  const editor = await screen.findByRole("textbox", { name: "Ruby source" });
  fireEvent.change(editor, { target: { value: "puts :trusted" } });
  fireEvent.change(screen.getByLabelText("Ruby バージョン"), {
    target: { value: "3.4" },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  expect(start).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toBe("共有コードの確認待ち");
  fireEvent.click(
    screen.getByRole("button", { name: "共有コードを信頼して有効にする" }),
  );
  await waitFor(() =>
    expect(start).toHaveBeenCalledWith(
      "puts :trusted",
      undefined,
      undefined,
      "3.4",
    ),
  );
  start.mockClear();
  fireEvent(window, new PopStateEvent("popstate"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
  expect(start).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "共有コードを信頼して有効にする" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "サンプルに戻す" }));
  await waitFor(() =>
    expect(start).toHaveBeenCalledWith(
      INITIAL_CODE,
      undefined,
      undefined,
      "3.3",
    ),
  );
});
