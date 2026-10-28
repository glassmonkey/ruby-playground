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
import { parseShareUrl, buildShareUrl } from "./share";
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
  it.each(['puts "こんにちは + & # 😀"', ""])(
    "automatically saves edited source %j with version and format",
    async (code) => {
      // Arrange
      window.history.replaceState(null, "", "/?campaign=ruby#about");
      setup();
      const editor = await screen.findByRole("textbox", {
        name: "Ruby source",
      });
      const historyLength = window.history.length;
      // Act
      fireEvent.change(editor, { target: { value: code } });
      fireEvent.change(screen.getByLabelText("Ruby バージョン"), {
        target: { value: "3.4" },
      });
      fireEvent.click(screen.getByRole("checkbox", { name: "HTML Preview" }));
      // Assert
      const url = new URL(window.location.href);
      expect({
        state: parseShareUrl(url, INITIAL_CODE),
        campaign: url.searchParams.get("campaign"),
        hash: url.hash,
        historyLength: window.history.length,
      }).toEqual({
        state: { code, version: "3.4", format: "html" },
        campaign: "ruby",
        hash: "#about",
        historyLength,
      });
    },
  );
  it("restores editor and format when browser history changes", async () => {
    // Arrange
    setup();
    const editor = await screen.findByRole("textbox", { name: "Ruby source" });
    // Act
    window.history.pushState(
      null,
      "",
      buildShareUrl(window.location.href, {
        code: "puts 42",
        version: "3.3",
        format: "html",
      }),
    );
    fireEvent(window, new PopStateEvent("popstate"));
    // Assert
    expect({
      code: (editor as HTMLTextAreaElement).value,
      version: (screen.getByLabelText("Ruby バージョン") as HTMLSelectElement)
        .value,
      html: (
        screen.getByRole("checkbox", {
          name: "HTML Preview",
        }) as HTMLInputElement
      ).checked,
    }).toEqual({ code: "puts 42", version: "3.3", html: true });
  });
  it("shows loading immediately on edits and hides it when execution finishes", async () => {
    // Arrange
    setup();
    const editor = await screen.findByRole("textbox", { name: "Ruby source" });
    await screen.findByText("出力なし");
    // Act
    fireEvent.change(editor, { target: { value: "puts 42" } });
    // Assert
    expect(screen.getByLabelText("実行中")).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("実行中")).toBeNull());
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
    fireEvent.change(editor, { target: { value: "puts :previous" } });
    fireEvent.change(editor, { target: { value: code } });

    expect((await screen.findByRole("alert")).textContent).toContain(
      "URL に保存できません。コードが長すぎるため、短くしてください。",
    );
    expect(editor.value).toBe(code);
    expect(new URL(window.location.href).searchParams.has("c")).toBe(false);
    fireEvent.change(editor, { target: { value: "puts :recovered" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(parseShareUrl(window.location.href, INITIAL_CODE).code).toBe(
      "puts :recovered",
    );
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
