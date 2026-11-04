# Supplies the selected Ruby version while the shared Ruby 4.0 analysis VM
# parses source and loads that version's RBS signatures.
module PlaygroundRubyVersion
  class << self
    attr_accessor :target, :core_root
  end

  def self.with(target, core_root)
    previous = [self.target, self.core_root]
    self.target, self.core_root = target, core_root
    yield
  ensure
    self.target, self.core_root = previous
  end
end

Prism.singleton_class.prepend(Module.new do
  def parse(source, **options)
    options[:version] = "#{PlaygroundRubyVersion.target}.0" if PlaygroundRubyVersion.target
    super(source, **options)
  end

  def parse_lex(source, **options)
    options[:version] = "#{PlaygroundRubyVersion.target}.0" if PlaygroundRubyVersion.target
    super(source, **options)
  end
end)

RubyIndexer::RBSIndexer.prepend(Module.new do
  def index_ruby_core
    root = PlaygroundRubyVersion.core_root
    return super unless root

    loader = RBS::EnvironmentLoader.new(core_root: nil)
    loader.add(path: Pathname(root))
    RBS::Environment.from_loader(loader).resolve_type_names
    loader.each_signature do |_source, path, _buffer, declarations, _directives|
      process_signature(path, declarations)
    end
  end
end)

class VersionedAnalysisServer < PlaygroundAnalysisServer
  SUPPORTED_TARGETS = { "3.3" => "3.4.0", "4.0" => "3.10.0" }.freeze

  def initialize(target, core_root)
    raise ArgumentError, "Unsupported Ruby analysis version" unless SUPPORTED_TARGETS.key?(target)

    @target, @core_root = target, core_root
    PlaygroundRubyVersion.with(target, core_root) { super() }
  end

  def dispatch(json)
    PlaygroundRubyVersion.with(@target, @core_root) { super }
  end
end
