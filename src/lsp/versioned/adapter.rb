# Load the Ruby 4.0 bundled Prism extension before installing the version pin.
require "prism"

module PlaygroundRubyVersion
  TARGETS = { "3.3" => "3.3", "4.0" => "4.0" }.freeze

  class << self
    attr_accessor :target, :core_root
  end

  def self.with(target, core_root)
    raise ArgumentError, "Unsupported Ruby analysis version." unless TARGETS.key?(target)

    previous = [self.target, self.core_root]
    self.target, self.core_root = target, core_root
    yield
  ensure
    self.target, self.core_root = previous
  end
end

# The WASM parser is shared by both supported targets; pin Prism's grammar to
# the selected Ruby release for each TypeProf LSP dispatch.
Prism.singleton_class.prepend(Module.new do
  def parse(source, **options)
    options[:version] = PlaygroundRubyVersion::TARGETS.fetch(PlaygroundRubyVersion.target) if PlaygroundRubyVersion.target
    super(source, **options)
  end

  def parse_lex(source, **options)
    options[:version] = PlaygroundRubyVersion::TARGETS.fetch(PlaygroundRubyVersion.target) if PlaygroundRubyVersion.target
    super(source, **options)
  end
end)
