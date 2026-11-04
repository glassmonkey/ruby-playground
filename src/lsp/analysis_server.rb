# Thin adapter for Shopify Ruby LSP 0.26.11. The upstream server handles
# parsing, indexing, completion and text edits; this replaces its desktop
# transport, project scan and thread lifecycle with a single-file RPC entry.
require "rubygems"
require "ruby_lsp/internal"

# Ruby LSP 0.26.11 indexes RBS module_function signatures only on the singleton
# side. Keep their private instance-method form available to a single document.
RubyIndexer::RBSIndexer.prepend(Module.new do
  private

  def handle_method(member, owner)
    super
    super(member.update(kind: :instance, visibility: :private), owner) if member.kind == :singleton_instance
  end
end)

# At top level, implicit self is Object even though the lexical namespace is
# empty. Explicit receivers retain the upstream private-method visibility rule.
RubyLsp::Listeners::Completion.prepend(Module.new do
  private

  def complete_methods(node, name)
    original_context = @node_context
    if node.receiver.nil? && original_context.fully_qualified_name.empty?
      @node_context = original_context.dup
      @node_context.define_singleton_method(:fully_qualified_name) { "Object" }
    end
    super
  ensure
    @node_context = original_context
  end
end)

class PlaygroundAnalysisServer < RubyLsp::Server
  def initialize
    @test_mode = true
    @current_request_id = 1
    @global_state = RubyLsp::GlobalState.new
    @store = RubyLsp::Store.new(@global_state)
    @messages = []
  end

  def dispatch(json)
    message = JSON.parse(json, symbolize_names: true)
    @messages = []
    allowed = %w[
      initialize initialized textDocument/didOpen textDocument/didChange
      textDocument/didClose textDocument/completion textDocument/signatureHelp
      completionItem/resolve
    ]
    unless allowed.include?(message[:method])
      return JSON.generate([
        { jsonrpc: "2.0", id: message[:id], error: { code: -32601, message: "Method not supported" } },
      ])
    end

    if (document = message.dig(:params, :textDocument))
      document[:uri] = URI(document[:uri])
      if message[:method] == "textDocument/didChange" && message.dig(:params, :contentChanges)&.any? { |change| !change.key?(:range) }
        change = message[:params][:contentChanges].last
        @store.set(uri: document[:uri], source: change[:text], version: document[:version], language_id: :ruby)
        return JSON.generate([])
      end
      if %w[textDocument/completion textDocument/signatureHelp].include?(message[:method])
        current = @store.get(document[:uri])
        current.parse!
        @global_state.index.handle_change(document[:uri], current.source)
      end
    end
    process_message(message)
    JSON.generate(@messages)
  rescue StandardError => error
    JSON.generate([
      {
        jsonrpc: "2.0",
        id: message && message[:id],
        error: { code: -32603, message: error.message },
      },
    ])
  end

  private

  def send_message(message)
    @messages << { jsonrpc: "2.0" }.merge(message.to_hash)
    @current_request_id += 1 if message.is_a?(RubyLsp::Request)
  end

  def run_initialized
    @global_state.index.index_all(uris: [])
  end
end

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

$playground_lsp = nil
