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
import type { startGemInstall, startRubyRun } from "../workers/client";
import App from "../app";
import { INITIAL_CODE } from "../sample";
import { formatLockfile } from "../lockfile";
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
const install = vi.hoisted(() =>
  vi.fn<typeof startGemInstall>(() => ({
    promise: Promise.resolve({ lock: [] }),
    cancel: vi.fn(),
  })),
);
vi.mock("../workers/client", () => ({
  startRubyRun: start,
  startGemInstall: install,
}));
afterEach(() => {
  cleanup();
  start.mockClear();
  install.mockClear();
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
        { gemfile: "" },
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
        { gemfile: "" },
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
        state: { code, version: "3.4", gemfile: "" },
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
    { gemfile: "" },
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

it("installs from the Gemfile tab, shares the lockfile and treats Gemfile edits as stale", async () => {
  // Arrange
  const lock = [
    { name: "faker", version: "3.8.0", source: "rubygems" as const },
  ];
  install.mockImplementation(() => ({
    promise: Promise.resolve({ lock }),
    cancel: vi.fn(),
  }));
  setup();
  fireEvent.click(await screen.findByRole("tab", { name: "Gemfile" }));
  const editor = await screen.findByRole("textbox", { name: "Ruby source" });
  fireEvent.change(editor, { target: { value: 'gem "faker"\n' } });
  // Act
  fireEvent.click(screen.getByRole("button", { name: "bundle install" }));
  await screen.findByText("Gemfile.lock matches the Gemfile", {
    exact: false,
  });
  await waitFor(() =>
    expect(start).toHaveBeenLastCalledWith(
      INITIAL_CODE,
      undefined,
      undefined,
      "4.0",
      expect.any(Function),
      { gemfile: 'gem "faker"\n', lock },
    ),
  );
  const installedUrl = parseShareUrl(window.location.href, INITIAL_CODE);
  fireEvent.change(editor, { target: { value: 'gem "faker", "~> 3.7"\n' } });
  const staleNotice = screen.queryByText("Gemfile.lock is out of date", {
    exact: false,
  });
  const staleLockfile = screen.getByRole("heading", {
    name: "Gemfile.lock (out of date)",
  }).nextElementSibling?.textContent;
  const staleUrlHasLock = new URL(window.location.href).searchParams.has("l");
  fireEvent.change(editor, { target: { value: 'gem "faker"\n' } });
  // Assert
  expect({
    installedLock: installedUrl.lock,
    staleShown: staleNotice !== null,
    staleLockfile,
    staleUrlHasLock,
    revertedLock: parseShareUrl(window.location.href, INITIAL_CODE).lock,
  }).toEqual({
    installedLock: lock,
    staleShown: true,
    staleLockfile: formatLockfile(lock),
    staleUrlHasLock: false,
    revertedLock: lock,
  });
});

it("installs silently when opened without a lockfile and after switching Ruby", async () => {
  // Arrange
  const gemfile = 'gem "faker"\n';
  const lock = [
    { name: "faker", version: "3.8.0", source: "rubygems" as const },
  ];
  const pending: Array<(value: { lock: typeof lock }) => void> = [];
  install.mockImplementation(() => ({
    promise: new Promise((resolve) => pending.push(resolve)),
    cancel: vi.fn(),
  }));
  window.history.replaceState(
    null,
    "",
    buildShareUrl(window.location.href, { code: "puts 1", gemfile }),
  );
  // Act
  setup();
  await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const runsBeforeInstall = start.mock.calls.length;
  await act(async () => pending[0]({ lock }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Ruby version"), {
    target: { value: "3.4" },
  });
  await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
  // Assert
  expect({
    installs: install.mock.calls.map(([g, v]) => [g, v]),
    runsBeforeInstall,
    firstRun: start.mock.calls[0][5],
    urlLock: parseShareUrl(window.location.href, INITIAL_CODE).lock,
  }).toEqual({
    installs: [
      [gemfile, "4.0"],
      [gemfile, "3.4"],
    ],
    runsBeforeInstall: 0,
    firstRun: { gemfile, lock },
    urlLock: undefined,
  });
});

it("guides a missing require to the Gemfile without guessing the gem name", async () => {
  // Arrange
  start.mockImplementation(() => ({
    promise: Promise.resolve({
      stdout: "",
      stderr: "",
      output: "",
      error:
        "eval:1:in 'Kernel#require': cannot load such file -- faker (LoadError)",
    }),
    cancel: vi.fn(),
  }));
  window.history.replaceState(
    null,
    "",
    buildShareUrl(window.location.href, { code: 'require "faker"' }),
  );
  setup();
  // Act
  const open = await screen.findByRole("button", { name: "Open Gemfile" });
  const search = screen.getByRole("link", {
    name: 'Search rubygems.org for "faker"',
  });
  fireEvent.click(open);
  // Assert
  expect({
    search: search.getAttribute("href"),
    gemfileTab: screen
      .getByRole("tab", { name: "Gemfile" })
      .getAttribute("aria-selected"),
  }).toEqual({
    search: "https://rubygems.org/search?query=faker",
    gemfileTab: "true",
  });
});

it("searches rubygems.org with slashes turned into spaces", async () => {
  // Arrange
  start.mockImplementation(() => ({
    promise: Promise.resolve({
      stdout: "",
      stderr: "",
      output: "",
      error:
        "eval:1:in 'Kernel#require': cannot load such file -- rack/test (LoadError)",
    }),
    cancel: vi.fn(),
  }));
  window.history.replaceState(
    null,
    "",
    buildShareUrl(window.location.href, { code: 'require "rack/test"' }),
  );
  // Act
  setup();
  const search = await screen.findByRole("link", {
    name: 'Search rubygems.org for "rack test"',
  });
  // Assert
  expect(search.getAttribute("href")).toBe(
    "https://rubygems.org/search?query=rack%20test",
  );
});

it("keeps a LoadError in the output while the Gemfile is edited", async () => {
  // Arrange
  start.mockImplementation(() => ({
    promise: Promise.resolve({
      stdout: "",
      stderr: "",
      output: "",
      error:
        "eval:1:in 'Kernel#require': cannot load such file -- faker (LoadError)",
    }),
    cancel: vi.fn(),
  }));
  window.history.replaceState(
    null,
    "",
    buildShareUrl(window.location.href, { code: 'require "faker"' }),
  );
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Open Gemfile" }));
  const editor = await screen.findByRole("textbox", { name: "Ruby source" });
  // Act
  fireEvent.change(editor, { target: { value: 'gem "faker"\n' } });
  fireEvent.change(editor, { target: { value: 'gem "faker"\ngem "rake"\n' } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  // Assert
  expect({
    runs: start.mock.calls.length,
    guidance:
      screen.queryByText('Could not load "faker"', { exact: false }) !== null,
  }).toEqual({ runs: 1, guidance: true });
});

it("points a missing native extension to an issue instead of the Gemfile", async () => {
  // Arrange
  start.mockImplementation(() => ({
    promise: Promise.resolve({
      stdout: "",
      stderr: "",
      output: "",
      error:
        "/gems/installed/bigdecimal-4.1.3/lib/bigdecimal.rb:10:in 'Kernel#require': cannot load such file -- bigdecimal.so (LoadError)",
    }),
    cancel: vi.fn(),
  }));
  // Act
  setup();
  const issue = await screen.findByRole("link", { name: "Open an issue" });
  // Assert
  expect({
    issue: issue.getAttribute("href"),
    gemfileGuidance: screen.queryByRole("button", { name: "Open Gemfile" }),
  }).toEqual({
    issue:
      "https://github.com/glassmonkey/ruby-playground/issues/new?title=Support%20the%20bigdecimal%20gem%20(native%20extension)",
    gemfileGuidance: null,
  });
});
