// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { executeRuby } from "./runtime";

let module: WebAssembly.Module;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  module = await WebAssembly.compile(
    await readFile(
      require.resolve("@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm"),
    ),
  );
}, 30_000);
describe("real Ruby WASM runtime", () => {
  it("captures stdout, stderr, Unicode and partial writes in order", async () => {
    const result = await executeRuby(
      module,
      'print "こんにちは"; warn "warning"; puts "!"',
    );
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe("こんにちは!\n");
    expect(result.stderr).toBe("warning\n");
    expect(result.output).toBe("こんにちはwarning\n!\n");
  });
  it("finishes empty output without displaying return values", async () => {
    expect(await executeRuby(module, "1 + 2")).toEqual({
      stdout: "",
      stderr: "",
      output: "",
    });
    expect((await executeRuby(module, "")).error).toBeUndefined();
  });
  it("captures exceptions and syntax errors without losing preceding output", async () => {
    const exception = await executeRuby(module, 'puts "before"; raise "boom"');
    expect(exception.output).toBe("before\n");
    expect(exception.error).toContain("boom");
    expect((await executeRuby(module, "def broken(")).error).toContain(
      "SyntaxError",
    );
  });
  it("resets globals and constants across fresh VMs", async () => {
    await executeRuby(module, "$answer = 42; Answer = 42");
    expect(
      (
        await executeRuby(
          module,
          "puts defined?($answer).inspect; puts defined?(Answer).inspect",
        )
      ).output,
    ).toBe("nil\nnil\n");
  });
  it("bounds output and allows a later run", async () => {
    expect((await executeRuby(module, 'print "x" * 100001')).error).toContain(
      "Output limit",
    );
    expect((await executeRuby(module, 'puts "ok"')).output).toBe("ok\n");
  });
});

it("disables Ruby access to the JavaScript host", async () => {
  const result = await executeRuby(
    module,
    `require 'js'; JS.eval('globalThis.__rubyEscape = true')`,
  );
  expect(result.error).toContain("JavaScript bridge is disabled");
  expect((globalThis as Record<string, unknown>).__rubyEscape).toBeUndefined();
  expect(
    (await executeRuby(module, `require 'js'; JS.global`)).error,
  ).toContain("JavaScript bridge is disabled");
});
