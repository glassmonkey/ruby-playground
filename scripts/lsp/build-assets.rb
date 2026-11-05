require "digest"
require "fileutils"
require "json"
require "open-uri"
require "rubygems/package"
require "tmpdir"
require "bundler/setup"
require "zlib"

ROOT = File.expand_path("../..", __dir__)
DEST = File.join(ROOT, "assets", "lsp")
CACHE = File.join(ROOT, "build", "lsp-analysis")
CORE_GEMS = {
  "3.3" => { version: "3.4.0", sha256: "51c628482a9fa48ab8f14b861cc109f6d7d6339ceacf1ad826b02ec2a98c8b80", core_sha256: "d6ecbf1415cf80978f6ed528c9dca8fec204d563604a6dbd9447c72e40818120" },
  "4.0" => { version: "3.10.0", sha256: "e75b5f1313c71c9ee0fcea68bf97d3e5fe8ec7a641d4b5cd18bbc28c94ddf298", core_sha256: "95a8daa87b42345515c21564b83df904ba6e0931bf1857210b8bdf34b6e8d396" },
}.freeze
TYPEPROF = {
  version: "0.33.2",
  sha256: "aa777c684d578ed27dc3e5d4bc4104c9eb5a76eedf7f5dd3366d571eaa6ca7c3",
  source: "https://rubygems.org/downloads/typeprof-0.33.2.gem",
  license: "MIT",
}.freeze

def fetch_gem(version, expected_sha)
  path = File.join(CACHE, "rbs-#{version}.gem")
  FileUtils.mkdir_p(CACHE)
  unless File.file?(path) && Digest::SHA256.file(path).hexdigest == expected_sha
    URI.open("https://rubygems.org/downloads/rbs-#{version}.gem", read_timeout: 60) do |source|
      File.binwrite(path, source.read)
    end
  end
  actual = Digest::SHA256.file(path).hexdigest
  raise "RBS #{version} gem SHA-256 mismatch: #{actual}" unless actual == expected_sha
  path
end

def fetch_typeprof
  path = File.join(CACHE, "typeprof-#{TYPEPROF[:version]}.gem")
  FileUtils.mkdir_p(CACHE)
  spec = Gem::Specification.find_by_name("typeprof", TYPEPROF[:version])
  raise "TypeProf license metadata changed: #{spec.licenses.inspect}" unless spec.licenses == [TYPEPROF[:license]]
  unless File.file?(path) && Digest::SHA256.file(path).hexdigest == TYPEPROF[:sha256]
    if File.file?(spec.cache_file) && Digest::SHA256.file(spec.cache_file).hexdigest == TYPEPROF[:sha256]
      FileUtils.cp(spec.cache_file, path)
    else
      URI.open(TYPEPROF[:source], read_timeout: 60) do |source|
        File.binwrite(path, source.read)
      end
    end
  end
  actual = Digest::SHA256.file(path).hexdigest
  raise "TypeProf #{TYPEPROF[:version]} gem SHA-256 mismatch: #{actual}" unless actual == TYPEPROF[:sha256]
  path
end

FileUtils.rm_rf(DEST)
FileUtils.mkdir_p(File.join(DEST, "versioned"))
typeprof_gem = fetch_typeprof
typeprof_spec = Gem::Specification.find_by_name("typeprof", TYPEPROF[:version])
typeprof_details = TYPEPROF.merge(
  runtimeDependencies: typeprof_spec.runtime_dependencies.map do |dependency|
    { name: dependency.name, requirement: dependency.requirement.to_s }
  end,
)
raise "TypeProf package identity changed" unless File.basename(typeprof_gem) == "typeprof-#{TYPEPROF[:version]}.gem"
manifest = {
  typeprof: typeprof_details,
  analysisRuby: "4.0.0",
  rubyWasm: "2.10.1",
  prism: { version: "1.7.0", targets: CORE_GEMS.keys },
  files: {},
  core: {},
}

CORE_GEMS.each do |target, details|
  gem_path = fetch_gem(details[:version], details[:sha256])
  Dir.mktmpdir("typeprof-core-") do |dir|
    Gem::Package.new(gem_path).extract_files(dir)
    core_root = File.join(dir, "core")
    files = Dir.glob("**/*.rbs", base: core_root).sort_by { |path| path.split("/") }.to_h do |relative|
      [relative, File.binread(File.join(core_root, relative)).force_encoding(Encoding::UTF_8)]
    end
    content = JSON.generate(files, ascii_only: false)
    hash = Digest::SHA256.hexdigest(content)
    raise "RBS core #{target} SHA-256 mismatch: #{hash}" unless hash == details[:core_sha256]
    path = File.join(DEST, "versioned", "core-#{target}.json")
    File.binwrite(path, content)
    gzip_path = "#{path}.gz"
    Zlib::GzipWriter.open(gzip_path, Zlib::BEST_COMPRESSION) do |gzip|
      gzip.mtime = 0
      gzip.write(content)
    end
    FileUtils.rm_f(path)
    manifest[:files]["versioned/core-#{target}.json"] = {
      bytes: content.bytesize,
      sha256: hash,
      gzipBytes: File.size(gzip_path),
      gzipSha256: Digest::SHA256.file(gzip_path).hexdigest,
    }
    manifest[:core][target] = {
      rbs: details[:version],
      source: "https://rubygems.org/downloads/rbs-#{details[:version]}.gem",
      gemSha256: details[:sha256],
      files: files.length,
      bytes: content.bytesize,
      gzipBytes: File.size(gzip_path),
      gzipSha256: Digest::SHA256.file(gzip_path).hexdigest,
      sha256: hash,
      license: "Ruby OR BSD-2-Clause",
    }
    %w[ BSDL COPYING ].each do |name|
      source = File.join(dir, name.strip)
      FileUtils.cp(source, File.join(DEST, "versioned", "RBS-#{name.strip}")) if File.file?(source)
    end
  end
end

%w[analysis_server.rb versioned/adapter.rb].each do |relative|
  source = File.join(ROOT, "src", "lsp", relative)
  destination = File.join(DEST, relative)
  FileUtils.mkdir_p(File.dirname(destination))
  FileUtils.cp(source, destination)
end

notice = <<~NOTICE
  Ruby Playground analysis runtime distribution
  TypeProf 0.33.2 / Ruby 4.0.0 / ruby.wasm 2.10.1 / Prism 1.7.0
  RBS core: 3.4.0 for Ruby 3.3; 3.10.0 for Ruby 4.0

  Runtime gem notices and license texts:
NOTICE
%w[typeprof rbs logger ruby_wasm js].each do |name|
  spec = Gem::Specification.find_by_name(name)
  notice << "\n#{spec.name} #{spec.version} — #{Array(spec.licenses).join(", ")}\n#{spec.homepage}\n"
  candidates = Dir.glob(File.join(spec.full_gem_path, "{LICENSE*,COPYING*,BSDL,LEGAL,NOTICE*}"))
  if candidates.empty?
    notice << "No separate license text is shipped with this gem.\n"
  else
    candidates.each do |path|
      relative = path.delete_prefix("#{spec.full_gem_path}/")
      notice << "\n--- #{spec.name}/#{relative} ---\n"
      notice << File.read(path, encoding: "UTF-8")
      notice << "\n"
    end
  end
end
notice << <<~RBS_NOTICE

  RBS core signature files are included in versioned/core-3.3.json.gz and
  versioned/core-4.0.json.gz. Their licenses are available as
  versioned/RBS-COPYING and versioned/RBS-BSDL. The Ruby/ruby.wasm runtime
  notice is in /licenses/ruby-wasm-NOTICE.
RBS_NOTICE

notice << "\nTypeProf 0.33.2 is distributed under the MIT License; gem SHA-256: #{TYPEPROF[:sha256]}.\n"
File.write(File.join(DEST, "runtime-notice.txt"), notice)

wasm = File.join(CACHE, "typeprof-analysis.wasm")
raise "Missing TypeProf WASM: run scripts/lsp/build-analysis.rb first" unless File.file?(wasm)
wasm_hash = Digest::SHA256.file(wasm).hexdigest
gzip_wasm = File.join(DEST, "typeprof-analysis.wasm.gz")
Zlib::GzipWriter.open(gzip_wasm, Zlib::BEST_COMPRESSION) do |gzip|
  gzip.mtime = 0
  File.open(wasm, "rb") { |source| IO.copy_stream(source, gzip) }
end
manifest[:files]["typeprof-analysis.wasm"] = {
  bytes: File.size(wasm),
  sha256: wasm_hash,
  gzipBytes: File.size(gzip_wasm),
  gzipSha256: Digest::SHA256.file(gzip_wasm).hexdigest,
}

Dir.glob("**/*", base: DEST).select { |path| File.file?(File.join(DEST, path)) && !path.end_with?(".gz") }.sort.each do |relative|
  path = File.join(DEST, relative)
  compressed = File.join(DEST, "#{relative}.gz")
  bytes = File.binread(path)
  entry = {
    bytes: bytes.bytesize,
    sha256: Digest::SHA256.hexdigest(bytes),
  }
  if File.file?(compressed)
    entry[:gzipBytes] = File.size(compressed)
    entry[:gzipSha256] = Digest::SHA256.file(compressed).hexdigest
  end
  manifest[:files][relative] = entry
end
File.write(File.join(DEST, "manifest.json"), JSON.pretty_generate(manifest) + "\n")
puts "Prepared #{manifest[:files].length} verified LSP files in #{DEST}"
