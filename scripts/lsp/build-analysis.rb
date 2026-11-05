require "fileutils"
require "open3"
require "ruby_wasm"
require "ruby_wasm/cli"
require_relative "wasi-sdk-head-diagnostics"

WasiSdkHeadDiagnostics.install!

# Do not let the host pkg-config inject native archives into a WASI link. Each
# cross target below is provided explicitly by ruby_wasm.
RubyWasm::CrossRubyProduct.prepend(Module.new do
  def configure_args(*args)
    super + ["--with-pkg-config=/usr/bin/false"]
  end
end)

# Ruby 4.0.0 already ships Prism 1.7.0. Avoid linking a second copy into the
# same VM; TypeProf and the version adapter use that bundled Prism API.
RubyWasm::Packager.prepend(Module.new do
  def specs
    super.reject { |spec| spec.name == "prism" }
  end
end)

# macOS defaults to OpenSSL 4 on newer Homebrew installs, while this pinned
# ruby.wasm toolchain expects OpenSSL 3. On Linux, ruby_wasm selects its pinned
# target library and needs no host override.
if RUBY_PLATFORM.include?("darwin")
  openssl = ENV["LSP_HOST_OPENSSL_DIR"]
  unless openssl
    prefix, status = Open3.capture2("brew", "--prefix", "openssl@3")
    raise "OpenSSL 3 is required to build the WASI runtime" unless status.success?
    openssl = prefix.strip
  end
  raise "OpenSSL 3 directory does not exist" unless File.directory?(openssl)
  RubyWasm::BaseRubyProduct.prepend(Module.new do
    define_method(:build) do |executor|
      executor.mkdir_p(product_build_dir)
      @source.build(executor)
      return if Dir.exist?(install_dir)
      executor.system(
        @source.configure_file,
        "--prefix=#{install_dir}",
        "--disable-install-doc",
        "--with-openssl-dir=#{openssl}",
        "--with-libyaml-dir=#{`brew --prefix libyaml`.strip}",
        chdir: product_build_dir,
      )
      executor.system("make", "-j#{executor.process_count}", "install", chdir: product_build_dir)
    end
  end)
end

root = File.expand_path("../..", __dir__)
stage = File.join(root, "build", "lsp-analysis")
FileUtils.mkdir_p(stage)

RubyWasm::CLI.new(stdout: $stdout, stderr: $stderr).run([
  "build",
  "--ruby-version", "4.0",
  "--dest-dir", File.join(stage, "toolchain"),
  "--clean",
  "-o", File.join(stage, "typeprof-analysis.wasm"),
])
