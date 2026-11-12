require "json"
require "pathname"
require "prism"
require "typeprof/code_range"
require "typeprof/diagnostic"
require "typeprof/version"
require "typeprof/core"
require "typeprof/lsp/text"
require "typeprof/lsp/messages"
require "typeprof/lsp/server"
require "typeprof/lsp/util"

# TypeProf's core signatures must come from the selected analysis target, not
# from the Ruby version used to host the browser VM.
TypeProf::Core::Service.prepend(Module.new do
  private

  def load_rbs_declarations(_collection)
    loader = RBS::EnvironmentLoader.new(core_root: nil)
    loader.add(path: Pathname(PlaygroundRubyVersion.core_root))
    RBS::Environment.from_loader(loader)
  end
end)

# The editor sends one full-document snapshot for each version. TypeProf's
# upstream LSP Text implementation only accepts ranged incremental changes.
TypeProf::LSP::Text.prepend(Module.new do
  def apply_changes(changes, version)
    unless changes.length == 1 && changes.first.is_a?(Hash) &&
        !changes.first.key?(:range) && changes.first[:text].is_a?(String)
      raise ArgumentError, "TypeProf accepts one full-document change per notification."
    end

    @lines = self.class.split(changes.first[:text])
    validate
    @version = version
  end

  # TypeProf's default implementation treats LSP UTF-16 columns as Ruby
  # character offsets. Convert at the boundary, strip a typed method prefix
  # only for the temporary query, and restore the exact source snapshot.
  def modify_for_completion(_changes, position)
    row = position.fetch(:line)
    original_line = @lines.fetch(row)
    cursor = character_offset(original_line, position.fetch(:character))
    before_cursor = original_line[0...cursor]
    typed_prefix = before_cursor[/\.([[:alnum:]_!?=]+)\z/, 1]

    if typed_prefix
      prefix_start = cursor - typed_prefix.length
      @lines[row] = original_line[0...prefix_start] + original_line[cursor..]
      query_position = position.merge(
        character: position.fetch(:character) - utf16_length(typed_prefix),
      )
      modify_at_dot(query_position) { |string, trigger, pos| yield string, trigger, pos }
    elsif (implicit_prefix = before_cursor[/[[:alnum:]_!?=]+\z/])
      prefix_start = cursor - implicit_prefix.length
      before_prefix = original_line[0...prefix_start]
      @lines[row] = before_prefix + "self." + original_line[cursor..]
      query_position = position.merge(
        character: utf16_length(before_prefix) + utf16_length("self."),
      )
      modify_at_dot(query_position) { |string, trigger, pos| yield string, trigger, pos }
    else
      modify_at_dot(position) { |string, trigger, pos| yield string, trigger, pos }
    end
  ensure
    @lines[row] = original_line if original_line && row
  end

  private

  def modify_at_dot(position)
    row = position.fetch(:line)
    line = @lines.fetch(row)
    column = character_offset(line, position.fetch(:character))
    if column >= 2 && line[column - 1] == "." && line[column - 2] != "."
      original = line[column - 1]
      line[column - 1] = " "
      begin
        yield string, ".", position.merge(character: position.fetch(:character) - 2)
      ensure
        line[column - 1] = original
      end
    elsif column >= 3 && line[column - 2, 2] == "::"
      original = line[column - 2, 2]
      line[column - 2, 2] = "  "
      begin
        yield string, "::", position.merge(character: position.fetch(:character) - 3)
      ensure
        line[column - 2, 2] = original
      end
    else
      yield string, nil, position
    end
  end

  def character_offset(line, utf16_column)
    units = 0
    line.each_char.with_index do |character, index|
      return index if units >= utf16_column
      units += character.ord > 0xffff ? 2 : 1
    end
    line.length
  end

  def utf16_length(value)
    value.each_char.sum { |character| character.ord > 0xffff ? 2 : 1 }
  end
end)

class PlaygroundTypeProfWriter
  attr_accessor :messages

  def initialize
    @messages = []
  end

  def write(**message)
    @messages << message
  end
end

class PlaygroundTypeProfServer < TypeProf::LSP::Server
  def initialize(target, core_root, writer)
    @target = target
    @core_root = core_root
    @workspace_path = nil
    PlaygroundRubyVersion.with(target, core_root) do
      super({ output_parameter_names: true }, nil, writer)
    end
  end

  def add_workspaces(folders)
    raise ArgumentError, "TypeProf requires one explicit editor workspace." unless folders.length == 1

    @workspace_path = folders.first.delete_suffix("/")
    @cores[@workspace_path] = TypeProf::Core::Service.new(
      @core_options.merge(position_encoding: @position_encoding),
    )
  end

  def target_path?(path)
    @workspace_path &&
      (path == @workspace_path || path.start_with?("#{@workspace_path}/"))
  end

  def update_file(path, text)
    return unless target_path?(path)

    if text.nil?
      each_core(path) { |core| core.update_rb_ast(path, Prism.parse("")) }
    else
      super
    end
  end
end

class PlaygroundTypeProf
  SUPPORTED_TARGETS = { "3.3" => "3.4.0", "4.0" => "3.10.0" }.freeze
  ANALYSIS_DOCUMENT_URI = "file:///playground/main.rb".freeze
  MONACO_DOCUMENT_URI = /\Ainmemory:\/\/model\/[A-Za-z0-9_-]+\z/.freeze
  ALLOWED_METHODS = %w[
    initialize initialized textDocument/didOpen textDocument/didChange
    textDocument/didClose textDocument/completion
  ].freeze

  def initialize(target, core_root)
    raise ArgumentError, "Unsupported Ruby analysis version." unless SUPPORTED_TARGETS.key?(target)

    @target = target
    @core_root = core_root
    @writer = PlaygroundTypeProfWriter.new
    @server = PlaygroundTypeProfServer.new(target, core_root, @writer)
    @active_document_uri = nil
  end

  def dispatch(json)
    message = JSON.parse(json, symbolize_names: true)
    @writer.messages = []
    unless ALLOWED_METHODS.include?(message[:method])
      return method_not_found(message)
    end

    client_document_uri = normalize_document_uri!(message)
    source = completion_source(message)
    PlaygroundRubyVersion.with(@target, @core_root) do
      TypeProf::LSP::Message.find(message[:method]).new(@server, message).run
    end
    if message[:method] == "textDocument/didOpen"
      @active_document_uri = client_document_uri
    elsif message[:method] == "textDocument/didClose"
      @active_document_uri = nil
    end
    responses = JSON.parse(JSON.generate(@writer.messages), symbolize_names: true)
    add_completion_text_edits(message, source, responses) if message[:method] == "textDocument/completion"
    JSON.generate(responses)
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

  def normalize_document_uri!(message)
    method = message[:method]
    return unless method.start_with?("textDocument/")

    document = message.dig(:params, :textDocument)
    raise ArgumentError, "A Ruby document URI is required." unless document.is_a?(Hash)

    client_uri = document[:uri]
    analysis_uri = analysis_document_uri(client_uri)
    if method == "textDocument/didOpen"
      raise ArgumentError, "A Ruby document is already open." if @active_document_uri
    else
      raise ArgumentError, "The Ruby document URI is not the active editor model." unless client_uri == @active_document_uri
    end
    document[:uri] = analysis_uri
    client_uri
  end

  def analysis_document_uri(uri)
    return ANALYSIS_DOCUMENT_URI if uri == ANALYSIS_DOCUMENT_URI || (uri.is_a?(String) && MONACO_DOCUMENT_URI.match?(uri))

    raise ArgumentError, "The Ruby document URI is outside the analysis workspace."
  end

  def completion_source(message)
    return unless message[:method] == "textDocument/completion"

    uri = message.dig(:params, :textDocument, :uri)
    @server.open_texts[uri]&.string
  end

  def add_completion_text_edits(message, source, responses)
    return unless source

    position = message.dig(:params, :position)
    range = completion_range(source, position)
    responses.each do |entry|
      items = entry.dig(:result, :items)
      next unless items.is_a?(Array)

      items.each do |item|
        label = item[:label]
        next unless label.is_a?(String)

        item[:textEdit] = range.merge(newText: label)
      end
      add_local_variables(items, source, position, range)
    end
  end

  def completion_range(source, position)
    lines = source.split("\n", -1)
    row = position.fetch(:line)
    line = lines.fetch(row)
    cursor = character_offset(line, position.fetch(:character))
    prefix = line[0...cursor][/[[:alnum:]_!?=]*\z/]
    start = cursor - (prefix || "").length
    {
      range: {
        start: { line: row, character: utf16_length(line[0...start]) },
        end: { line: row, character: position.fetch(:character) },
      },
    }
  end

  def add_local_variables(items, source, position, range)
    prefix = current_prefix(source, position)
    return if prefix.nil? || prefix.empty?

    scope = lexical_scope(source, position)
    return unless scope

    labels = items.map { |item| item[:label] }
    scope.locals.map(&:to_s).uniq.sort.each do |name|
      next unless name.start_with?(prefix) && !labels.include?(name)

      items << {
        label: name,
        kind: 6,
        sortText: "zz#{name}",
        filterText: name,
        textEdit: range.merge(newText: name),
      }
    end
  end

  def current_prefix(source, position)
    line = source.split("\n", -1).fetch(position.fetch(:line))
    line[0...character_offset(line, position.fetch(:character))][/[[:alnum:]_]*\z/]
  end

  def lexical_scope(source, position)
    byte_offset = source.split("\n", -1).take(position.fetch(:line)).sum(&:bytesize)
    line = source.split("\n", -1).fetch(position.fetch(:line))
    byte_offset += line[0...character_offset(line, position.fetch(:character))].bytesize
    root = Prism.parse(source).value
    best = nil
    best_span = Float::INFINITY
    visit = lambda do |node|
      location = node.location
      span = location.end_offset - location.start_offset
      if node.respond_to?(:locals) &&
          location.start_offset <= byte_offset && byte_offset <= location.end_offset &&
          span < best_span
        best = node
        best_span = span
      end
      node.child_nodes.compact.each { |child| visit.call(child) }
    end
    visit.call(root)
    best
  end

  def character_offset(line, utf16_column)
    units = 0
    line.each_char.with_index do |character, index|
      return index if units >= utf16_column
      units += character.ord > 0xffff ? 2 : 1
    end
    line.length
  end

  def utf16_length(value)
    value.each_char.sum { |character| character.ord > 0xffff ? 2 : 1 }
  end

  def method_not_found(message)
    return JSON.generate([]) unless message[:id]

    JSON.generate([
      {
        jsonrpc: "2.0",
        id: message[:id],
        error: { code: -32601, message: "Method not supported." },
      },
    ])
  end
end
