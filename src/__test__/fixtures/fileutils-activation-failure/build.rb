require "rubygems/package"
Dir.chdir(__dir__) do
  spec = Gem::Specification.new do |gem|
    gem.name = "fileutils"
    gem.version = "1.7.2"
    gem.summary = "Synthetic component activation failure archive"
    gem.authors = ["Ruby Playground tests"]
    gem.files = ["lib/fileutils.rb"]
    gem.require_paths = ["lib"]
    gem.add_runtime_dependency "missing-fixture-dependency", ">= 0"
  end
  Gem::Package.build(spec)
end
