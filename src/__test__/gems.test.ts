// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { executeRuby } from "../runtime";
import { parseGemfile, type GemRequest, type ResolvedGem } from "../gems";
import { INITIAL_CODE, INITIAL_GEMFILE } from "../sample";
import { RUBY_VERSIONS, type RubyVersion } from "../versions";

let module: WebAssembly.Module;
let rainbowArchive: Uint8Array;
let artiiArchive: Uint8Array;
let artiiInfo: string;
let pastelArchive: Uint8Array;
let ttyColorArchive: Uint8Array;
let fileutilsArchive: Uint8Array;
let fileutilsActivationFailureArchive: Uint8Array;
const wasmPaths: Record<RubyVersion, string> = {
  "3.2": "@ruby/3.2-wasm-wasi/dist/ruby+stdlib.wasm",
  "3.3": "@ruby/3.3-wasm-wasi/dist/ruby+stdlib.wasm",
  "3.4": "@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm",
  "4.0": "@ruby/4.0-wasm-wasi/dist/ruby+stdlib.wasm",
  "4.1": "@ruby/head-wasm-wasi/dist/ruby+stdlib.wasm",
};
const wasmModules = new Map<RubyVersion, Promise<WebAssembly.Module>>();

function wasmFor(version: RubyVersion): Promise<WebAssembly.Module> {
  let wasm = wasmModules.get(version);
  if (!wasm) {
    const require = createRequire(import.meta.url);
    wasm = readFile(require.resolve(wasmPaths[version])).then((bytes) =>
      WebAssembly.compile(bytes),
    );
    wasmModules.set(version, wasm);
  }
  return wasm;
}

beforeAll(async () => {
  module = await wasmFor("4.0");
  artiiArchive = await readFile(
    new URL(
      "../../proxy/test-fixtures/cassettes/gems/artii-2.1.2.gem",
      import.meta.url,
    ),
  );
  artiiInfo = await readFile(
    new URL(
      "../../proxy/test-fixtures/cassettes/info/artii.body",
      import.meta.url,
    ),
    "utf8",
  );
  rainbowArchive = await readFile(
    new URL(
      "../../proxy/test-fixtures/cassettes/gems/rainbow-3.1.1.gem",
      import.meta.url,
    ),
  );
  pastelArchive = await readFile(
    new URL(
      "../../proxy/test-fixtures/cassettes/gems/pastel-0.8.0.gem",
      import.meta.url,
    ),
  );
  ttyColorArchive = await readFile(
    new URL(
      "../../proxy/test-fixtures/cassettes/gems/tty-color-0.6.0.gem",
      import.meta.url,
    ),
  );
  fileutilsArchive = await readFile(
    new URL("./fixtures/fileutils-1.7.3.synthetic.gem", import.meta.url),
  );
  fileutilsActivationFailureArchive = await readFile(
    new URL("./fixtures/fileutils-1.7.2.synthetic.gem", import.meta.url),
  );
}, 30_000);

const POSTER_OUTPUT = [
  "+-----------------------------+",
  "|     ____        __          |",
  "|    / __ \\__  __/ /_  __  __ |",
  "|   / /_/ / / / / __ \\/ / / / |",
  "|  / _, _/ /_/ / /_/ / /_/ /  |",
  "| /_/ |_|\\__,_/_.___/\\__, /   |",
  "|                   /____/    |",
  "|                             |",
  "| Made with Ruby + gems       |",
  "+-----------------------------+",
  "",
].join("\n");

const posterRuntimeCases = [
  {
    version: "3.2",
    wantStderr: [
      "Ignoring debug-1.7.1 because its extensions are not built. Try: gem pristine debug --version 1.7.1",
      "Ignoring rbs-2.8.2 because its extensions are not built. Try: gem pristine rbs --version 2.8.2",
      "",
    ].join("\n"),
  },
  { version: "3.3", wantStderr: "" },
  { version: "3.4", wantStderr: "" },
  { version: "4.0", wantStderr: "" },
  { version: "4.1", wantStderr: "" },
] as const satisfies readonly {
  version: RubyVersion;
  wantStderr: string;
}[];

describe("default poster sample", () => {
  it.each(posterRuntimeCases)(
    "resolves and runs the recorded Artii sample on Ruby $version",
    async ({ version, wantStderr }) => {
      const requested: string[] = [];
      const result = await executeRuby(
        await wasmFor(version),
        INITIAL_CODE,
        undefined,
        {
          requests: parseGemfile(INITIAL_GEMFILE),
          fetchInfo: async (name) => {
            requested.push(`/info/${name}`);
            return artiiInfo;
          },
          fetchGem: async (fileName) => {
            requested.push(`/gems/${fileName}`);
            return artiiArchive;
          },
        },
      );

      expect({
        error: result.error,
        stderr: result.stderr,
        stdout: result.stdout,
        requested,
      }).toEqual({
        error: undefined,
        stderr: wantStderr,
        stdout: POSTER_OUTPUT,
        requested: ["/info/artii", "/gems/artii-2.1.2.gem"],
      });
    },
  );
});

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
  it.each(["", "\n # no dependencies\n"])(
    "returns no requests for empty Gemfile input %j",
    (gemfile) => {
      const got = parseGemfile(gemfile);

      expect(got).toEqual([]);
    },
  );
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
  it.each(["RedCloth", "rack-test"])("accepts valid gem name %s", (name) => {
    const got = parseGemfile(`gem "${name}"`);

    expect(got).toEqual([{ name, requirements: [] }]);
  });
  it.each(['gem "_hidden"', 'gem "-hidden"', 'gem "123"', 'gem "has space"'])(
    "rejects invalid gem name in %s",
    (line) => {
      const sut = () => parseGemfile(line);

      expect(sut).toThrow(
        'Gemfile line 1: gem name must contain a letter and use only letters, numbers, ".", "-" or "_".',
      );
    },
  );
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
  const backtrackCases: [string, GemRequest[]][] = [
    [
      "builtin root precedes the dependency",
      [
        { name: "prime", requirements: [">= 0"] },
        { name: "ant", requirements: [">= 0"] },
      ],
    ],
    [
      "dependency precedes the builtin root",
      [
        { name: "ant", requirements: [">= 0"] },
        { name: "prime", requirements: [">= 0"] },
      ],
    ],
  ];
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
  it.each(RUBY_VERSIONS)(
    "selects the Ruby-compatible pure build on Ruby %s",
    async (version) => {
      // Synthetic compact-index component fixture: exclude native and future-Ruby builds.
      const index = [
        "---",
        "1.0.0 |checksum:0,ruby:>= 3.2",
        "2.0.0-x86_64-linux |checksum:0,ruby:>= 3.2",
        "3.0.0 |checksum:0,ruby:>= 9.0",
      ].join("\n");
      const fetched: string[] = [];
      let resolved: ResolvedGem[] = [];
      const result = await executeRuby(await wasmFor(version), "", undefined, {
        requests: [{ name: "platform-choice", requirements: [] }],
        fetchInfo: async (name) => {
          fetched.push(name);
          return index;
        },
        fetchGem: async () => {
          throw new Error("offline");
        },
        onResolved: (gems) => {
          resolved = gems;
        },
      });

      expect({ error: result.error, fetched, resolved }).toEqual({
        error: "offline",
        fetched: ["platform-choice"],
        resolved: [
          { name: "platform-choice", version: "1.0.0", source: "rubygems" },
        ],
      });
    },
  );
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
  it("runs code with an empty Gemfile without requesting gem data", async () => {
    const result = await executeRuby(module, 'puts "no gems"', undefined, {
      requests: [],
      fetchInfo: async () => {
        throw new Error("empty Gemfile must not fetch metadata");
      },
      fetchGem: async () => {
        throw new Error("empty Gemfile must not fetch gem files");
      },
    });

    expect(result).toEqual({
      stdout: "no gems\n",
      stderr: "",
      output: "no gems\n",
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
  it.each(backtrackCases)(
    "backtracks from bundled prime when %s",
    async (_case, requests) => {
      const index: Record<string, string> = {
        ant: "---\n1.0.0 prime:< 0.1.4|checksum:0",
        forwardable: "---",
        prime: "---\n0.1.3 |checksum:0",
        singleton: "---",
      };
      const fetched: string[] = [];
      let resolved: ResolvedGem[] = [];
      const result = await executeRuby(module, "", undefined, {
        requests,
        fetchInfo: async (name) => {
          fetched.push(name);
          return index[name];
        },
        fetchGem: async () => {
          throw new Error("offline");
        },
        onResolved: (gems) => {
          resolved = gems;
        },
      });

      expect({
        error: result.error,
        fetched: fetched.sort(),
        resolved: resolved.sort((a, b) => a.name.localeCompare(b.name)),
      }).toEqual({
        error: "offline",
        fetched: ["ant", "forwardable", "prime", "singleton"],
        resolved: [
          { name: "ant", version: "1.0.0", source: "rubygems" },
          { name: "prime", version: "0.1.3", source: "rubygems" },
        ],
      });
    },
  );
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
  it.each(RUBY_VERSIONS)(
    "registers and activates a real locked gem after extraction on Ruby %s",
    async (version) => {
      const ruby = await wasmFor(version);
      const requested: string[] = [];
      const result = await executeRuby(
        ruby,
        [
          'require "rainbow"',
          'puts Gem.loaded_specs["rainbow"]&.version',
          'gem "rainbow", "= 3.1.1"',
          'puts Gem.loaded_specs.fetch("rainbow").version',
        ].join("\n"),
        undefined,
        {
          requests: [{ name: "rainbow", requirements: ["= 3.1.1"] }],
          locked: [{ name: "rainbow", version: "3.1.1", source: "rubygems" }],
          fetchInfo: async () => {
            throw new Error("a locked version must not fetch metadata");
          },
          fetchGem: async (fileName) => {
            requested.push(fileName);
            return rainbowArchive;
          },
        },
      );

      expect({
        error: result.error,
        output: result.output,
        requested,
      }).toEqual({
        error: undefined,
        output: "3.1.1\n3.1.1\n",
        requested: ["rainbow-3.1.1.gem"],
      });
    },
  );
  it("activates a locked gem and its pure Ruby dependency together", async () => {
    const requested: string[] = [];
    const archives = new Map([
      ["pastel-0.8.0.gem", pastelArchive],
      ["tty-color-0.6.0.gem", ttyColorArchive],
    ]);
    const result = await executeRuby(
      module,
      [
        'require "pastel"',
        'puts Pastel.new(enabled: false).green("dependency ready")',
        'puts Gem.loaded_specs.fetch("pastel").version',
        'puts Gem.loaded_specs.fetch("tty-color").version',
      ].join("\n"),
      undefined,
      {
        requests: [
          { name: "pastel", requirements: ["= 0.8.0"] },
          { name: "tty-color", requirements: ["= 0.6.0"] },
        ],
        locked: [
          { name: "pastel", version: "0.8.0", source: "rubygems" },
          { name: "tty-color", version: "0.6.0", source: "rubygems" },
        ],
        fetchInfo: async () => {
          throw new Error("locked versions must not fetch metadata");
        },
        fetchGem: async (fileName) => {
          requested.push(fileName);
          const archive = archives.get(fileName);
          if (!archive) throw new Error(`unexpected gem request: ${fileName}`);
          return archive;
        },
      },
    );

    expect({
      error: result.error,
      output: result.output,
      requested: requested.sort(),
    }).toEqual({
      error: undefined,
      output: "dependency ready\n0.8.0\n0.6.0\n",
      requested: ["pastel-0.8.0.gem", "tty-color-0.6.0.gem"],
    });
  });
  it.each(RUBY_VERSIONS)(
    "activates and runs the locked fileutils gem instead of the builtin on Ruby %s",
    async (version) => {
      const ruby = await wasmFor(version);
      const requested: string[] = [];
      const runtimeVersions: string[] = [];
      let installed = false;
      const result = await executeRuby(
        ruby,
        [
          'require "fileutils"',
          "puts FileUtils::VERSION_MARKER",
          'puts Gem.loaded_specs.fetch("fileutils").version',
          'gem "fileutils", "= 1.7.3"',
        ].join("\n"),
        ({ version: runtimeVersion }) => {
          runtimeVersions.push(runtimeVersion.split(".").slice(0, 2).join("."));
        },
        {
          requests: [{ name: "fileutils", requirements: ["= 1.7.3"] }],
          locked: [{ name: "fileutils", version: "1.7.3", source: "rubygems" }],
          fetchInfo: async () => {
            throw new Error("locked versions must not fetch metadata");
          },
          fetchGem: async (fileName) => {
            requested.push(fileName);
            return fileutilsArchive;
          },
          onInstalled: () => {
            installed = true;
          },
        },
      );

      expect({
        error: result.error,
        output: result.output,
        requested,
        runtimeVersions,
        installed,
      }).toEqual({
        error: undefined,
        output: "fileutils 1.7.3 loaded\n1.7.3\n",
        requested: ["fileutils-1.7.3.gem"],
        runtimeVersions: [version],
        installed: true,
      });
    },
  );
  it("keeps the JavaScript bridge disabled in a fresh gem user VM", async () => {
    let installed = false;
    const result = await executeRuby(
      module,
      `require "js"; JS.global`,
      undefined,
      {
        requests: [{ name: "fileutils", requirements: ["= 1.7.3"] }],
        locked: [{ name: "fileutils", version: "1.7.3", source: "rubygems" }],
        fetchInfo: async () => {
          throw new Error("locked versions must not fetch metadata");
        },
        fetchGem: async () => fileutilsArchive,
        onInstalled: () => {
          installed = true;
        },
      },
    );

    expect({
      blocked: result.error?.includes("JavaScript bridge is disabled"),
      installed,
    }).toEqual({
      blocked: true,
      installed: true,
    });
  });
  it("does not report installation when an extracted gem cannot activate", async () => {
    let installed = false;
    const requested: string[] = [];
    const result = await executeRuby(
      module,
      'puts "user code ran"',
      undefined,
      {
        requests: [{ name: "fileutils", requirements: ["= 1.7.2"] }],
        locked: [{ name: "fileutils", version: "1.7.2", source: "rubygems" }],
        fetchInfo: async () => {
          throw new Error("locked versions must not fetch metadata");
        },
        fetchGem: async (fileName) => {
          requested.push(fileName);
          return fileutilsActivationFailureArchive;
        },
        onInstalled: () => {
          installed = true;
        },
      },
    );

    expect({
      error: result.error,
      output: result.output,
      requested,
      installed,
    }).toEqual({
      error: expect.stringContaining("missing-fixture-dependency"),
      output: "",
      requested: ["fileutils-1.7.2.gem"],
      installed: false,
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
