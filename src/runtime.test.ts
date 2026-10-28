// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { INITIAL_CODE } from "./sample";
import { RUBY_PATCH_VERSIONS } from "./versions";
import { executeRuby, type RuntimeInfo } from "./runtime";

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

for (const version of ["4.0", "3.4", "3.3"] as const) {
  it(`executes the actual pinned Ruby ${version} build with host bridge blocked`, async () => {
    const require = createRequire(import.meta.url);
    const compiled = await WebAssembly.compile(
      await readFile(
        require.resolve(`@ruby/${version}-wasm-wasi/dist/ruby+stdlib.wasm`),
      ),
    );
    let info: RuntimeInfo | undefined;
    const result = await executeRuby(compiled, "puts RUBY_VERSION", (next) => {
      info = next;
    });
    const expected = {
      "4.0": {
        releaseDate: "2025-12-25",
        revision: "553f1675f3a9cece340b90f374a4245dccac2272",
      },
      "3.4": {
        releaseDate: "2024-12-25",
        revision: "48d4efcb85000e1ebae42004e963b5d0cedddcf2",
      },
      "3.3": {
        releaseDate: "2024-06-12",
        revision: "f1c7b6f435f1167a0514b39a5f72f55cec4d1426",
      },
    };
    expect(info).toEqual({
      version: RUBY_PATCH_VERSIONS[version],
      platform: "wasm32-wasi",
      encoding: "UTF-8",
      ...expected[version],
    });
    expect(result.output).toBe(`${RUBY_PATCH_VERSIONS[version]}\n`);
    expect(result.error).toBeUndefined();
    expect(result.output).toMatch(
      new RegExp(`^${version.replace(".", "\\.")}\\.\\d+\\n$`),
    );
    expect(
      (await executeRuby(compiled, `require 'js'; JS.global`)).error,
    ).toContain("JavaScript bridge is disabled");
  }, 30_000);
}

it("reports real VM information before user code prints or raises", async () => {
  // Arrange
  const reports: RuntimeInfo[] = [];
  // Act
  const result = await executeRuby(
    module,
    'puts "user output"; raise "boom"',
    (info) => reports.push(info),
  );
  // Assert
  expect({
    reports,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output,
    raised: result.error?.includes("boom"),
  }).toEqual({
    reports: [
      {
        version: "4.0.0",
        platform: "wasm32-wasi",
        releaseDate: "2025-12-25",
        revision: "553f1675f3a9cece340b90f374a4245dccac2272",
        encoding: "UTF-8",
      },
    ],
    stdout: "user output\n",
    stderr: "",
    output: "user output\n",
    raised: true,
  });
});

it("executes the initial fractal sample with aligned plain-text output", async () => {
  // Act
  const result = await executeRuby(module, INITIAL_CODE);
  // Assert
  const rows = result.output.trimEnd().split("\n");
  expect({
    error: result.error,
    stderr: result.stderr,
    rows: rows.map((row) => row.trimEnd()),
    widths: result.output
      .split("\n")
      .slice(0, -1)
      .map((row) => row.length),
  }).toEqual({
    error: undefined,
    stderr: "",
    rows: [
      "                     Hello",
      "                     Ruby!",
      "                  Hello Hello",
      "                  Ruby! Ruby!",
      "               Hello       Hello",
      "               Ruby!       Ruby!",
      "            Hello Hello Hello Hello",
      "            Ruby! Ruby! Ruby! Ruby!",
      "         Hello                   Hello",
      "         Ruby!                   Ruby!",
      "      Hello Hello             Hello Hello",
      "      Ruby! Ruby!             Ruby! Ruby!",
      "   Hello       Hello       Hello       Hello",
      "   Ruby!       Ruby!       Ruby!       Ruby!",
      "Hello Hello Hello Hello Hello Hello Hello Hello",
      "Ruby! Ruby! Ruby! Ruby! Ruby! Ruby! Ruby! Ruby!",
    ],
    widths: [47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47],
  });
});
