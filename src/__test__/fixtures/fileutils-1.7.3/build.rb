require "rubygems/package"
Dir.chdir(__dir__) do
  spec = Gem::Specification.new do |gem|
    gem.name = "fileutils"
    gem.version = "1.7.3"
    gem.summary = "Synthetic component test archive"
    gem.authors = ["Ruby Playground tests"]
    gem.files = ["lib/fileutils.rb"]
    gem.require_paths = ["lib"]
  end
  Gem::Package.build(spec)
end
