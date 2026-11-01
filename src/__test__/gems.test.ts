// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { executeRuby } from "../runtime";
import { parseGemfile, type ResolvedGem } from "../gems";

let module: WebAssembly.Module;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  module = await WebAssembly.compile(
    await readFile(
      require.resolve("@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm"),
    ),
  );
}, 30_000);

const COMPACT_INDEX: Record<string, string> = {
  faker: [
    "---",
    "3.7.1 i18n:< 2&>= 1.8.11|checksum:0,ruby:>= 3.2",
    "3.8.0 i18n:< 2&>= 1.8.11|checksum:0,ruby:>= 3.2",
    "4.0.0.beta1 i18n:>= 2|checksum:0",
  ].join("\n"),
  i18n: [
    "---",
    "1.14.0 concurrent-ruby:~> 1.0|checksum:0",
    "1.15.2 concurrent-ruby:~> 1.0,json:>= 2|checksum:0,ruby:>= 3.1",
    "1.16.0 concurrent-ruby:~> 1.0|checksum:0,ruby:>= 9.9",
  ].join("\n"),
  "concurrent-ruby": [
    "---",
    "1.3.5 |checksum:0",
    "1.3.6-java |checksum:0",
  ].join("\n"),
};

async function resolveWith(requirements: string[]) {
  const fetched: string[] = [];
  let resolved: ResolvedGem[] = [];
  const result = await executeRuby(module, "", undefined, {
    requests: [{ name: "faker", requirements }],
    fetchInfo: async (name) => {
      fetched.push(name);
      return COMPACT_INDEX[name];
    },
    fetchGem: async () => {
      throw new Error("offline");
    },
    onResolved: (gems) => {
      resolved = gems;
    },
  });
  const byName = (a: ResolvedGem, b: ResolvedGem) =>
    a.name.localeCompare(b.name);
  return { result, fetched: fetched.sort(), resolved: resolved.sort(byName) };
}

describe("Gemfile parsing", () => {
  it("reads names and optional requirements, skipping source and comments", () => {
    expect(
      parseGemfile(
        [
          'source "https://rubygems.org"',
          "",
          'gem "faker" # newest',
          "gem 'i18n', '~> 1.15', '>= 1.15.2'",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "faker", requirements: [] },
      { name: "i18n", requirements: ["~> 1.15", ">= 1.15.2"] },
    ]);
  });
  it.each([
    ['gem "faker", "latest"', 'write gem "name"'],
    ["if ENV['CI']", 'write gem "name"'],
    ['source "https://gem.coop"', 'only source "https://rubygems.org"'],
    ["group :development, :test do", "blocks such as group"],
    ["platforms :jruby do", "blocks such as group"],
    ["end", "blocks such as group"],
    ['ruby "3.4.1"', "Version menu"],
    ["gemspec", "gemspec is not available"],
    ['gem "faker", require: false', "Write require in main.rb"],
    ['gem "rspec", :require => false', "Write require in main.rb"],
    ['gem "rspec", group: :test', "group: is not available"],
    ['gem "faker", platforms: :jruby', "platforms: is not available"],
    ['gem "faker", github: "faker-ruby/faker"', "rubygems.org can be used"],
    ['gem "local", path: "../local"', "rubygems.org can be used"],
  ])("rejects %j on its line with the reason", (line, reason) => {
    expect(() => parseGemfile(`gem "rake"\n${line}`)).toThrow(
      new RegExp(
        `^Gemfile line 2: .*${reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
  });
  it("accepts the rubygems.org source line without changing anything", () => {
    expect(parseGemfile('source "https://rubygems.org"\ngem "faker"')).toEqual([
      { name: "faker", requirements: [] },
    ]);
  });
});

describe("dependency resolution in the real Ruby WASM runtime", () => {
  it("resolves the newest compatible chain and uses gems bundled with Ruby", async () => {
    const { result, fetched, resolved } = await resolveWith(["~> 3.7"]);
    expect({ error: result.error, fetched, resolved }).toEqual({
      error: "offline",
      fetched: ["concurrent-ruby", "faker", "i18n"],
      resolved: [
        { name: "concurrent-ruby", version: "1.3.5", source: "rubygems" },
        { name: "faker", version: "3.8.0", source: "rubygems" },
        { name: "i18n", version: "1.15.2", source: "rubygems" },
        { name: "json", version: "2.18.0", source: "builtin" },
      ],
    });
  });
  it("reports a requirement that no published version satisfies", async () => {
    const { result, resolved } = await resolveWith(["~> 9.0"]);
    expect({ error: result.error, resolved }).toEqual({
      error:
        "Could not resolve gem dependencies: Unable to resolve dependency: user requested 'faker (~> 9.0)'",
      resolved: [],
    });
  });
  it("runs code with a bundled gem without downloading anything", async () => {
    const result = await executeRuby(
      module,
      'require "prime"; p Prime.first(3)',
      undefined,
      {
        requests: [{ name: "prime", requirements: [] }],
        fetchInfo: async () => {
          throw new Error("offline");
        },
        fetchGem: async () => {
          throw new Error("offline");
        },
      },
    );
    expect(result).toEqual({
      stdout: "[2, 3, 5]\n",
      stderr: "",
      output: "[2, 3, 5]\n",
    });
  });
  it("uses locked versions without fetching the index or reporting a resolution", async () => {
    let reported = false;
    const result = await executeRuby(
      module,
      'require "prime"; p Prime.first(2)',
      undefined,
      {
        requests: [{ name: "prime", requirements: [] }],
        locked: [{ name: "prime", version: "0.1.4", source: "builtin" }],
        fetchInfo: async () => {
          throw new Error("index must not be fetched");
        },
        fetchGem: async () => {
          throw new Error("offline");
        },
        onResolved: () => {
          reported = true;
        },
      },
    );
    expect({ output: result.output, error: result.error, reported }).toEqual({
      output: "[2, 3]\n",
      error: undefined,
      reported: false,
    });
  });
  it("backtracks to older versions when the newest ones conflict", async () => {
    // ant 2 needs bee 2, which needs cat >= 2; the Gemfile pins cat < 2.
    const index: Record<string, string> = {
      ant: "---\n1.0.0 bee:>= 1|checksum:0\n2.0.0 bee:>= 2|checksum:0",
      bee: "---\n1.0.0 cat:>= 1|checksum:0\n2.0.0 cat:>= 2|checksum:0",
      cat: "---\n1.0.0 |checksum:0\n2.0.0 |checksum:0",
    };
    let resolved: ResolvedGem[] = [];
    await executeRuby(module, "", undefined, {
      requests: [
        { name: "ant", requirements: [] },
        { name: "cat", requirements: ["< 2"] },
      ],
      fetchInfo: async (name) => index[name],
      fetchGem: async () => {
        throw new Error("offline");
      },
      onResolved: (gems) => {
        resolved = gems;
      },
    });
    expect(
      resolved.map(({ name, version }) => `${name} ${version}`).sort(),
    ).toEqual(["ant 1.0.0", "bee 1.0.0", "cat 1.0.0"]);
  });
  it("leaves no resolver or extraction changes visible to user code", async () => {
    const result = await executeRuby(
      module,
      "p [defined?(JSON), File.method(:chmod).source_location, File.instance_method(:chmod).source_location]",
      undefined,
      {
        requests: [{ name: "prime", requirements: [] }],
        fetchInfo: async () => {
          throw new Error("offline");
        },
        fetchGem: async () => {
          throw new Error("offline");
        },
      },
    );
    expect(result).toEqual({
      stdout: "[nil, nil, nil]\n",
      stderr: "",
      output: "[nil, nil, nil]\n",
    });
  });
  it("downloads a locked version that this build's image does not have", async () => {
    const requested: string[] = [];
    const result = await executeRuby(module, 'require "prime"', undefined, {
      requests: [{ name: "prime", requirements: [] }],
      locked: [{ name: "prime", version: "0.1.3", source: "builtin" }],
      fetchInfo: async () => {
        throw new Error("index must not be fetched");
      },
      fetchGem: async (fileName) => {
        requested.push(fileName);
        throw new Error("offline");
      },
    });
    expect({ requested, error: result.error }).toEqual({
      requested: ["prime-0.1.3.gem"],
      error: "offline",
    });
  });
  it.each([
    ["every gem extracts", "prime", "builtin", true],
    ["a download is not a gem", "broken", "rubygems", false],
  ] as const)(
    "reports installation only when %s",
    async (_case, name, source, want) => {
      let installed = false;
      await executeRuby(module, "", undefined, {
        requests: [{ name, requirements: [] }],
        locked: [{ name, version: "0.1.4", source }],
        fetchInfo: async () => {
          throw new Error("index must not be fetched");
        },
        fetchGem: async () => new TextEncoder().encode("not a gem"),
        onInstalled: () => {
          installed = true;
        },
      });
      expect(installed).toBe(want);
    },
  );
});
