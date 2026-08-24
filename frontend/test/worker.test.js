import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@ruby/wasm-wasi/dist/browser", () => ({
  DefaultRubyVM: vi.fn(),
}));

import { DefaultRubyVM } from "@ruby/wasm-wasi/dist/browser";
import "../src/worker.js";

describe("worker onmessage", () => {
  let postMessageSpy;

  beforeEach(() => {
    postMessageSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      }),
    );
    vi.spyOn(WebAssembly, "compile").mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    DefaultRubyVM.mockReset();
  });

  test.each([
    { label: "integer result", code: "1 + 2", evalResult: "3" },
    { label: "string result", code: "'hi'.upcase", evalResult: "HI" },
  ])("posts ok: true with the evaluated result on success ($label)", async ({ code, evalResult }) => {
    DefaultRubyVM.mockResolvedValue({
      vm: { eval: () => ({ toString: () => evalResult }) },
    });
    const sut = self.onmessage;

    await sut({ data: { code } });

    expect(postMessageSpy).toHaveBeenCalledWith({ ok: true, result: evalResult });
  });

  test("posts ok: false with the error message when vm.eval throws", async () => {
    DefaultRubyVM.mockResolvedValue({
      vm: {
        eval: () => {
          throw new Error("undefined method `foo'");
        },
      },
    });
    const sut = self.onmessage;

    await sut({ data: { code: "foo" } });

    expect(postMessageSpy).toHaveBeenCalledWith({
      ok: false,
      error: "undefined method `foo'",
    });
  });

  test("posts ok: false with the error message when fetching ruby.wasm fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const sut = self.onmessage;

    await sut({ data: { code: "1 + 2" } });

    expect(postMessageSpy).toHaveBeenCalledWith({
      ok: false,
      error: "network error",
    });
  });
});
