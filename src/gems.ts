import type { RubyVM } from "@ruby/wasm-wasi";
import { Directory, File, type Inode } from "@bjorn3/browser_wasi_shim";
import { GEM_NAME } from "./gem-proxy";

/** Experiment: one Gemfile `gem` line, with zero or more requirement strings. */
export type GemRequest = { name: string; requirements: string[] };
/** "builtin" gems already ship inside ruby+stdlib.wasm and are not downloaded. */
export type ResolvedGem = {
  name: string;
  version: string;
  source: "rubygems" | "builtin";
};
export type GemSource = {
  /** rubygems.org compact index text for `/info/<name>`. */
  fetchInfo: (name: string) => Promise<string>;
  fetchGem: (fileName: string) => Promise<Uint8Array>;
};

const RUBYGEMS_SOURCE = /^source\s+(["'])https?:\/\/rubygems\.org\/?\1$/;
const GEM_LINE = /^gem\s+(["'])([^"']+)\1((?:\s*,\s*(["'])[^"']*\4)*)$/;
const REQUIREMENT = /^\s*(=|!=|>|<|>=|<=|~>)?\s*\d[\dA-Za-z.]*\s*$/;
// One round per index entry the resolver asks for.
const MAX_ROUNDS = 50;

// Bundler syntax that has no meaning in a single-file browser playground is
// rejected with the reason, rather than accepted and ignored. Checked in order.
const UNSUPPORTED: [RegExp, string][] = [
  [
    /^(group|platforms?)\b.*\bdo$|^end$/,
    "blocks such as group ... do ... end are not available here. Write the gem lines on their own.",
  ],
  [
    /^ruby\b/,
    "choose the Ruby version with the Version menu instead of a ruby line.",
  ],
  [/^gemspec\b/, "gemspec is not available here."],
  [
    /^gem\b.*(\brequire:|:require\s*=>)/,
    "require: is not needed here. Write require in main.rb instead.",
  ],
  [
    /^gem\b.*(\bgroups?:|:groups?\s*=>)/,
    "group: is not available here. Remove it.",
  ],
  [
    /^gem\b.*(\bplatforms?:|:platforms?\s*=>)/,
    "platforms: is not available here. Every gem runs on the same Ruby.",
  ],
  [
    /^gem\b.*(\b(git|github|path|branch|tag|ref|source):|:(git|github|path|branch|tag|ref|source)\s*=>)/,
    "only gems published on rubygems.org can be used. git:, github: and path: are not available.",
  ],
];

/** Only `gem "name"` with optional version requirements, plus the default source. */
export function parseGemfile(gemfile: string): GemRequest[] {
  return gemfile.split("\n").flatMap((line, index) => {
    const statement = line.replace(/#.*$/, "").trim();
    const fail = (reason: string): never => {
      throw new Error(`Gemfile line ${index + 1}: ${reason}`);
    };
    if (statement === "") return [];
    // rubygems.org is always used, so naming it changes nothing; any other
    // source would silently fetch something other than what the Gemfile names.
    if (/^source\s/.test(statement)) {
      if (RUBYGEMS_SOURCE.test(statement)) return [];
      fail('only source "https://rubygems.org" is supported.');
    }
    const match = GEM_LINE.exec(statement);
    if (match && !GEM_NAME.test(match[2]))
      fail(
        'gem name must contain a letter and use only letters, numbers, ".", "-" or "_".',
      );
    const requirements = match
      ? [...match[3].matchAll(/["']([^"']*)["']/g)].map((found) => found[1])
      : [];
    if (match && requirements.every((value) => REQUIREMENT.test(value)))
      return [{ name: match[2], requirements }];
    const unsupported = UNSUPPORTED.find(([pattern]) =>
      pattern.test(statement),
    );
    return fail(
      unsupported?.[1] ?? 'write gem "name" or gem "name", "~> 1.0".',
    );
  });
}

// RubyGems' own backtracking resolver (Molinillo) over the compact index files
// in /gems/index. A name without a file raises; the caller fetches it and runs
// this again. Gems already in the image
// are offered first, so they win whenever they satisfy the requirement.
// Everything lives inside a lambda so user code does not see its locals, and
// the result is plain text so json is not loaded before user code.
const RESOLVER = `
-> do
  require "rubygems"
  require "rubygems/resolver"
  begin
    require "rubygems/vendor/uri/lib/uri"
  rescue LoadError => error
    raise unless error.path == "rubygems/vendor/uri/lib/uri"
    require "uri"
  end
  require "stringio"
  missing_error = Class.new(StandardError)
  ruby_version = Gem::Version.new(RUBY_VERSION)
  index_path = ->(name) { "/gems/index/#{name}" }
  fallback_path = "/gems/fallback.txt"
  fallback_names = File.exist?(fallback_path) ? File.read(fallback_path).split("\n") : []
  builtin_candidates = []
  set_class = Class.new(Gem::Resolver::APISet) do
    define_method(:versions) do |name|
      return @data[name] if @data.key?(name)
      raise missing_error, name unless File.exist?(index_path.(name))
      index_lines = File.read(index_path.(name)).split("\n")
      header = index_lines.index("---")
      parser = Gem::Resolver::APISet::GemParser.new
      index_lines.drop(header ? header + 1 : 0).each do |line|
        number, platform, dependencies, requirements = parser.parse(line)
        platform ||= "ruby"
        @data[name] << {
          name: name, number: number, platform: platform, suffix: platform,
          dependencies: dependencies.map { |dep, reqs| [dep, reqs.join(", ")] },
          requirements: requirements.map { |key, reqs| [key.to_sym, reqs] }.to_h,
        }
      end
      @data[name]
    end
    # Prefetching makes find_all read every name queued so far, including
    # dependencies of versions never chosen: faker would need 9 index entries
    # instead of 3. Looking names up only when asked is faster here.
    define_method(:prefetch) { |_reqs| }
    define_method(:find_all) do |req|
      builtin = Gem::Specification.find_all_by_name(req.name)
        .select { |spec| req.dependency.match?(spec.name, spec.version) }.max_by(&:version)
      if builtin
        builtin_candidates << req.name
        installed = Gem::Resolver::InstalledSpecification.new(self, builtin)
        next [installed] unless fallback_names.include?(req.name)
        external = super(req).select { |spec| spec.required_ruby_version.satisfied_by?(ruby_version) }
        next [installed, *external]
      end
      super(req).select { |spec| spec.required_ruby_version.satisfied_by?(ruby_version) }
    end
  end
  resolver_class = Class.new(Gem::Resolver) do
    # The stock check downloads each candidate's gemspec; find_all already
    # dropped versions this Ruby cannot run.
    define_method(:requirement_satisfied_by?) do |requirement, _activated, spec|
      requirement.matches_spec?(spec)
    end
    # Progress goes to IO::NULL, which the WASI filesystem does not have.
    define_method(:output) { @output ||= StringIO.new }
  end
  roots = File.read("/gems/roots.txt").split("\n").map do |line|
    name, *requirements = line.split("\t")
    Gem::Dependency.new(name, *(requirements.empty? ? [">= 0"] : requirements))
  end
  begin
    lines = resolver_class.new(roots, set_class.new).resolve.map do |request|
      builtin = request.spec.is_a?(Gem::Resolver::InstalledSpecification)
      "#{request.name} #{request.version}#{" builtin" if builtin}"
    end
    (["resolved"] + lines).join("\n")
  rescue missing_error => e
    "missing #{e.message}"
  rescue Gem::DependencyResolutionError, Gem::UnsatisfiableDependencyError => e
    if builtin_candidates.empty?
      "error #{e.message}"
    else
      "fallback #{builtin_candidates.uniq.join(",")}\nerror #{e.message}"
    end
  end
end.call
`;

// WASI has no chmod and reports permission bits as 000, so RubyGems' extraction
// needs chmod stubbed out; the originals come back before user code runs.
const EXTRACT = `
-> do
  require "rubygems"
  require "rubygems/package"
  require "fileutils"
  instance_chmod = File.instance_method(:chmod)
  class_chmod = File.singleton_class.instance_method(:chmod)
  # RubyGems 4.1 drains the archive via IO.copy_stream(..., IO::NULL).
  copy_stream = IO.singleton_class.instance_method(:copy_stream)
  File.define_method(:chmod) { |*| 0 }
  File.singleton_class.define_method(:chmod) { |*| 0 }
  IO.singleton_class.define_method(:copy_stream) do |source, destination, *args|
    if destination == IO::NULL
      total = 0
      while chunk = source.read(16 * 1024)
        total += chunk.bytesize
      end
      total
    else
      copy_stream.bind(self).call(source, destination, *args)
    end
  end
  begin
    Dir.glob("/gems/*.gem").sort.each do |path|
      package = Gem::Package.new(path)
      dest = "/gems/installed/#{package.spec.full_name}"
      package.extract_files(dest)
      package.spec.full_gem_path = dest
      File.write("/gems/#{package.spec.full_name}.gemspec", package.spec.to_ruby)
    end
  ensure
    File.define_method(:chmod, instance_chmod)
    File.singleton_class.define_method(:chmod, class_chmod)
    IO.singleton_class.define_method(:copy_stream, copy_stream)
  end
end.call
`;

// Load installed specs in the fresh user VM so setup-only RubyGems activations
// cannot conflict with a locked gem of the same name.
const ACTIVATE_INSTALLED = `
-> do
  require "rubygems"
  specifications = Dir.glob("/gems/*.gemspec").sort.map do |path|
    specification = Gem::Specification.load(path)
    raise "Could not load installed gem specification: #{path}" unless specification
    specification.full_gem_path = "/gems/installed/#{specification.full_name}"
    Gem::Specification.add_spec(specification)
    specification
  end
  specifications.each(&:activate)
end.call
`;

const RESOLVED_LINE = /^([^ ]+) (\d[\dA-Za-z.]*)( builtin)?$/;

/** Resolve inside the VM, fetching compact index entries until nothing is missing. */
export async function resolveGems(
  vm: RubyVM,
  files: Map<string, Inode>,
  requests: GemRequest[],
  source: Pick<GemSource, "fetchInfo">,
): Promise<ResolvedGem[]> {
  const encoder = new TextEncoder();
  const index = new Map<string, Inode>();
  const fallbackNames = new Set<string>();
  files.set("index", new Directory(index));
  const roots = requests.map(({ name, requirements }) =>
    [name, ...requirements].join("\t"),
  );
  files.set("roots.txt", new File(encoder.encode(roots.join("\n"))));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const outcome = vm.eval(RESOLVER).toString();
    if (outcome.startsWith("fallback ")) {
      const [fallbackLine, errorLine, ...details] = outcome.split("\n");
      const names = fallbackLine.slice("fallback ".length).split(",");
      const pending = names.filter((name) => !fallbackNames.has(name));
      if (pending.length === 0) {
        const error = [errorLine.slice("error ".length), ...details].join("\n");
        throw new Error(`Could not resolve gem dependencies: ${error}`);
      }
      await Promise.all(
        pending.map(async (name) => {
          if (!index.has(name))
            index.set(
              name,
              new File(encoder.encode(await source.fetchInfo(name))),
            );
          fallbackNames.add(name);
        }),
      );
      files.set(
        "fallback.txt",
        new File(encoder.encode([...fallbackNames].join("\n"))),
      );
      continue;
    }
    if (outcome.startsWith("error "))
      throw new Error(
        `Could not resolve gem dependencies: ${outcome.slice("error ".length)}`,
      );
    if (outcome.startsWith("missing ")) {
      const names = outcome.slice("missing ".length).split(",");
      await Promise.all(
        names.map(async (name) => {
          index.set(
            name,
            new File(encoder.encode(await source.fetchInfo(name))),
          );
        }),
      );
      continue;
    }
    return outcome
      .split("\n")
      .slice(1)
      .map((line) => {
        const match = RESOLVED_LINE.exec(line);
        if (!match || !GEM_NAME.test(match[1]))
          throw new Error(`Unexpected resolver output: ${line}`);
        return {
          name: match[1],
          version: match[2],
          source: match[3] ? "builtin" : "rubygems",
        };
      });
  }
  throw new Error("Gem dependency resolution did not finish.");
}

// Which of the "name version" lines in /gems/builtin.txt this build's image has.
const IMAGE_HAS = `
-> do
  require "rubygems"
  File.read("/gems/builtin.txt").split("\n").select do |line|
    name, version = line.split(" ")
    Gem::Specification.find_all_by_name(name).any? { |spec| spec.version.to_s == version }
  end.join("\n")
end.call
`;

/**
 * Download and extract gems into /gems. The lockfile decides
 * the version: a locked image gem is used from the image only when this build
 * has exactly that version, and otherwise comes from rubygems.org.
 */
export async function installGems(
  vm: RubyVM,
  files: Map<string, Inode>,
  resolved: ResolvedGem[],
  source: Pick<GemSource, "fetchGem">,
): Promise<void> {
  const builtin = resolved.filter((gem) => gem.source === "builtin");
  const inImage = new Set<string>();
  if (builtin.length > 0) {
    const lines = builtin.map(({ name, version }) => `${name} ${version}`);
    files.set(
      "builtin.txt",
      new File(new TextEncoder().encode(lines.join("\n"))),
    );
    for (const line of vm.eval(IMAGE_HAS).toString().split("\n"))
      inImage.add(line);
  }
  await Promise.all(
    resolved
      .filter(
        ({ name, version, source: from }) =>
          from === "rubygems" || !inImage.has(`${name} ${version}`),
      )
      .map(async ({ name, version }) => {
        const fileName = `${name}-${version}.gem`;
        files.set(fileName, new File(await source.fetchGem(fileName)));
      }),
  );
  vm.eval(EXTRACT);
}

/** Register and activate extracted specs in the fresh VM that will run user code. */
export function activateInstalledGems(vm: RubyVM): void {
  vm.eval(ACTIVATE_INSTALLED);
}
