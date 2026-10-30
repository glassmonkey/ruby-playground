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
import { parseShareUrl, buildShareUrl } from "../share";
import type { startRubyRun } from "../workers/client";
import App from "../app";
import { INITIAL_CODE } from "../sample";
vi.mock("../editor", () => ({
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
  vi.fn<typeof startRubyRun>(() => ({
    promise: Promise.resolve({ stdout: "", stderr: "", output: "" }),
    cancel: vi.fn(),
  })),
);
vi.mock("../workers/client", () => ({ startRubyRun: start }));
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
    expect(screen.queryByRole("button", { name: /^(Run|Rerun)$/ })).toBeNull();
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        INITIAL_CODE,
        undefined,
        undefined,
        "4.0",
        expect.any(Function),
      ),
    );
    fireEvent.change(editor, { target: { value: "" } });
    await screen.findByText("No output");
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        "",
        undefined,
        undefined,
        "4.0",
        expect.any(Function),
      ),
    );
  });
  it("labels editor and output sections and links to the safety pages", () => {
    setup();
    expect(screen.getByRole("region", { name: "Editor" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Output" })).toBeTruthy();
    const navigation = screen.getByRole("navigation", {
      name: "Legal and contact",
    });
    expect(
      Array.from(navigation.querySelectorAll("a")).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["Privacy Policy", "./privacy.html"],
      ["Contact", "https://twitter.com/glassmonekey"],
      [
        "License",
        "https://github.com/glassmonkey/ruby-playground/blob/main/LICENSE",
      ],
    ]);
  });
  it.each(['puts "こんにちは + & # 😀"', ""])(
    "automatically saves edited source %j with version",
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
      fireEvent.change(screen.getByLabelText("Ruby version"), {
        target: { value: "3.4" },
      });
      // Assert
      const url = new URL(window.location.href);
      expect({
        state: parseShareUrl(url, INITIAL_CODE),
        campaign: url.searchParams.get("campaign"),
        hash: url.hash,
        historyLength: window.history.length,
      }).toEqual({
        state: { code, version: "3.4" },
        campaign: "ruby",
        hash: "#about",
        historyLength,
      });
    },
  );
  it("restores editor and version when browser history changes", async () => {
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
      }),
    );
    fireEvent(window, new PopStateEvent("popstate"));
    // Assert
    expect({
      code: (editor as HTMLTextAreaElement).value,
      version: (screen.getByLabelText("Ruby version") as HTMLSelectElement)
        .value,
    }).toEqual({ code: "puts 42", version: "3.3" });
  });
  it("shows loading immediately on edits and hides it when execution finishes", async () => {
    // Arrange
    setup();
    const editor = await screen.findByRole("textbox", { name: "Ruby source" });
    await screen.findByText("No output");
    // Act
    fireEvent.change(editor, { target: { value: "puts 42" } });
    // Assert
    expect(screen.getByLabelText("Running")).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("Running")).toBeNull());
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
      "The code is too long to save in the URL. Please shorten it.",
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
  fireEvent.change(screen.getByLabelText("Ruby version"), {
    target: { value: "3.4" },
  });
  expect(cancellations[0]).toHaveBeenCalled();
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start).toHaveBeenLastCalledWith(
    "puts :latest",
    undefined,
    undefined,
    "3.4",
    expect.any(Function),
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

it("updates environment independently and rejects a cancelled run's late metadata", async () => {
  // Arrange
  setup();
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  const oldInfo = start.mock.calls[0][4]!;
  const ruby40 = {
    version: "4.0.0",
    platform: "wasm32-wasi",
    encoding: "UTF-8",
    releaseDate: "2025-12-25",
    revision: "553f1675f3",
  };
  // Act
  act(() => oldInfo(ruby40));
  fireEvent.change(screen.getByLabelText("Ruby version"), {
    target: { value: "3.3" },
  });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  act(() =>
    start.mock.calls[1][4]!({
      ...ruby40,
      version: "3.3.3",
      releaseDate: "2024-06-12",
      revision: "f1c7b6f435",
    }),
  );
  act(() => oldInfo(ruby40));
  // Assert
  expect(
    screen.getByRole("region", { name: "Ruby runtime environment" })
      .textContent,
  ).toContain("Ruby 3.3.3");
});
