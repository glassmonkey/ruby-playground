// The probe snippets for issue #29's ruby.wasm capability survey.
//
// Every snippet is plain Ruby whose last expression is the string we want to
// read back. They are written with String.raw so that a backslash-n in this
// file reaches Ruby as a backslash-n escape (i.e. Ruby's own newline), not as
// a literal line break that would terminate the Ruby string literal. Do not
// use backticks or dollar-brace inside these snippets.
//
// `hangRisk: true` marks probes that are expected to be able to wedge the VM
// forever. The driver gives those a deadline and terminates + rebuilds the
// worker when they blow it -- the hang itself is a result, not a crash.

export const PROBES = [
  // ---------------------------------------------------------------- baseline
  {
    id: "env",
    group: "0. baseline",
    label: "Ruby build identity",
    question: "どの Ruby がバンドルされているか (ADR-0015 当時と同じか)",
    code: String.raw`
r = []
r << "RUBY_DESCRIPTION: #{RUBY_DESCRIPTION}"
r << "RUBY_VERSION: #{RUBY_VERSION}"
r << "RUBY_ENGINE: #{RUBY_ENGINE}"
r << "RUBY_PLATFORM: #{RUBY_PLATFORM}"
r << "RUBY_ENGINE_VERSION: #{RUBY_ENGINE_VERSION}"
r.join("\n")
`,
  },

  // ------------------------------------------- B. 型推論の材料 (論点3 選択肢B)
  {
    id: "rbs",
    group: "B. 型推論の材料",
    label: "RBS がバンドルに同梱されているか",
    question: "論点3 選択肢B (推論) が RBS を型の出どころにできるか",
    code: String.raw`
r = []
r << "defined?(RBS): #{defined?(RBS).inspect}"
begin
  require "rbs"
  r << "require rbs: ok, RBS::VERSION=#{(defined?(RBS::VERSION) ? RBS::VERSION : "n/a")}"
rescue Exception => e
  r << "require rbs: #{e.class}: #{e.message}"
end
begin
  require "rbs/cli"
  r << "require rbs/cli: ok"
rescue Exception => e
  r << "require rbs/cli: #{e.class}: #{e.message}"
end
r << "$LOADED_FEATURES matching rbs: #{$LOADED_FEATURES.grep(/rbs/).first(5).inspect}"
r.join("\n")
`,
  },
  {
    id: "gems",
    group: "B. 型推論の材料",
    label: "同梱 gem と load path",
    question: "型情報を持つ gem (rbs/prism/typeprof) が同梱されているか",
    code: String.raw`
require "rbconfig"
r = []
r << "$LOAD_PATH: #{$LOAD_PATH.inspect}"
r << "rubylibdir: #{RbConfig::CONFIG["rubylibdir"].inspect}"
r << "prefix: #{RbConfig::CONFIG["prefix"].inspect}"
begin
  r << "Gem.loaded_specs: #{Gem.loaded_specs.keys.sort.inspect}"
rescue Exception => e
  r << "Gem.loaded_specs: #{e.class}: #{e.message}"
end
begin
  names = Gem::Specification.map(&:name).sort
  r << "Gem::Specification (#{names.size}): #{names.inspect}"
rescue Exception => e
  r << "Gem::Specification: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "vfs",
    group: "B. 型推論の材料",
    label: "WASI 仮想 FS のレイアウト",
    question: "signature ファイルを置ける/持っている場所があるか",
    code: String.raw`
r = []
["/", "/usr", "/usr/local", "/usr/local/lib", "/usr/local/lib/ruby", "/usr/local/lib/ruby/4.0.0"].each do |d|
  begin
    r << "#{d} -> #{Dir.entries(d).sort.first(40).inspect}"
  rescue Exception => e
    r << "#{d} -> #{e.class}: #{e.message}"
  end
end
r.join("\n")
`,
  },
  {
    id: "stdlib-listing",
    group: "B. 型推論の材料",
    label: "バンドルに同梱されている stdlib の全量",
    question: "そもそも何が require できるのか (Timeout / RBS / Prism 不在の裏取り)",
    timeoutMs: 20000,
    code: String.raw`
require "rbconfig"
libdir = RbConfig::CONFIG["rubylibdir"]
r = []
r << "rubylibdir: #{libdir.inspect}"
begin
  entries = Dir.entries(libdir).reject { |e| e.start_with?(".") }.sort
  rbs_top = entries.select { |e| e.end_with?(".rb") }
  dirs = entries.reject { |e| e.end_with?(".rb") }
  r << "top-level .rb files (#{rbs_top.size}): #{rbs_top.inspect}"
  r << "sub-directories (#{dirs.size}): #{dirs.inspect}"
rescue Exception => e
  r << "Dir.entries(libdir): #{e.class}: #{e.message}"
end
begin
  all = Dir.glob(File.join(libdir, "**", "*")).size
  r << "total entries under rubylibdir: #{all}"
rescue Exception => e
  r << "glob: #{e.class}: #{e.message}"
end
r << "$LOADED_FEATURES.size: #{$LOADED_FEATURES.size}"
r.join("\n")
`,
  },
  {
    id: "rbs-files",
    group: "B. 型推論の材料",
    label: ".rbs シグネチャファイルの実在",
    question: "RBS の core/stdlib シグネチャが FS 上にあるか",
    timeoutMs: 20000,
    code: String.raw`
require "rbconfig"
roots = ($LOAD_PATH + [RbConfig::CONFIG["prefix"]]).compact.uniq
found = []
scanned = []
roots.each do |root|
  break if found.size >= 10
  begin
    hits = Dir.glob(File.join(root, "**", "*.rbs"))
    scanned << "#{root} (#{hits.size})"
    found.concat(hits.first(10))
  rescue Exception => e
    scanned << "#{root} (#{e.class})"
  end
end
"scanned: #{scanned.inspect}\nfound: #{found.first(10).inspect}"
`,
  },
  {
    id: "gem-dir",
    group: "B. 型推論の材料",
    label: "同梱 gem ディレクトリの実体",
    question: "rubygems 経由で activate されていないだけで、物理的には在る gem があるか",
    timeoutMs: 20000,
    code: String.raw`
require "rbconfig"
gemroot = File.join(RbConfig::CONFIG["prefix"], "lib", "ruby", "gems", RbConfig::CONFIG["ruby_version"], "gems")
r = []
r << "gem root: #{gemroot}"
begin
  entries = Dir.entries(gemroot).reject { |e| e.start_with?(".") }.sort
  r << "gems on disk (#{entries.size}): #{entries.inspect}"
rescue Exception => e
  r << "Dir.entries(gem root): #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "ripper",
    group: "B. 型推論の材料",
    label: "Ripper の可用性 (ADR-0015 検証1 の再確認)",
    question: "ADR-0015 の「Ripper 使用不可」はビルド選択の帰結だったのか",
    code: String.raw`
r = []
begin
  require "ripper"
  r << "require ripper: ok"
rescue Exception => e
  r << "require ripper: #{e.class}: #{e.message}"
end
r << "defined?(Ripper): #{defined?(Ripper).inspect}"
begin
  r << "Ripper.singleton_methods.sort: #{Ripper.singleton_methods.sort.inspect}"
rescue Exception => e
  r << "Ripper.singleton_methods: #{e.class}: #{e.message}"
end
begin
  r << "Ripper.lex('a.up'): #{Ripper.lex("a.up").inspect}"
rescue Exception => e
  r << "Ripper.lex: #{e.class}: #{e.message}"
end
begin
  r << "Ripper.sexp('a.up'): #{Ripper.sexp("a.up").inspect}"
rescue Exception => e
  r << "Ripper.sexp: #{e.class}: #{e.message}"
end
begin
  r << "Ripper.sexp('a.') (incomplete): #{Ripper.sexp("a.").inspect}"
rescue Exception => e
  r << "Ripper.sexp incomplete: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "repl-type-completor",
    group: "B. 型推論の材料",
    label: "repl_type_completor (IRB の型ベース補完エンジン)",
    question: "論点3 選択肢B を自作せず既存エンジンに乗せられるか",
    isolate: true,
    timeoutMs: 30000,
    code: String.raw`
require "rbconfig"
gemroot = File.join(RbConfig::CONFIG["prefix"], "lib", "ruby", "gems", RbConfig::CONFIG["ruby_version"], "gems")
r = []
begin
  Dir.entries(gemroot).reject { |e| e.start_with?(".") }.each do |g|
    lib = File.join(gemroot, g, "lib")
    $LOAD_PATH.unshift(lib) if Dir.exist?(lib)
  end
  r << "activated #{gemroot} lib dirs onto $LOAD_PATH"
rescue Exception => e
  r << "activation failed: #{e.class}: #{e.message}"
end
["rbs", "prism", "repl_type_completor"].each do |lib|
  begin
    require lib
    r << "require #{lib}: ok"
  rescue Exception => e
    r << "require #{lib}: #{e.class}: #{e.message}"
  end
end
if defined?(ReplTypeCompletor)
  r << "ReplTypeCompletor.singleton_methods.sort: #{ReplTypeCompletor.singleton_methods.sort.inspect}"
  begin
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    ReplTypeCompletor.preload_rbs
    r << "preload_rbs: ok in #{((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round}ms"
  rescue Exception => e
    r << "preload_rbs: #{e.class}: #{e.message}"
  end
  begin
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    res = ReplTypeCompletor.analyze("s = 'abc'\ns.up", binding: TOPLEVEL_BINDING, filename: "(probe)")
    took = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round
    r << "analyze: #{res.inspect[0, 200]} in #{took}ms"
    r << "candidates: #{(res && res.completion_candidates ? res.completion_candidates.first(15).inspect : "nil")}"
  rescue Exception => e
    r << "analyze: #{e.class}: #{e.message}"
  end
end
r.join("\n")
`,
  },
  {
    id: "prism",
    group: "B. 型推論の材料",
    label: "Prism パーサの可用性",
    question: "ADR-0015 が試していない第3のパーサが使えるか (Ripper 不在の代替)",
    code: String.raw`
r = []
r << "defined?(Prism): #{defined?(Prism).inspect}"
begin
  require "prism"
  r << "require prism: ok, VERSION=#{(defined?(Prism::VERSION) ? Prism::VERSION : "n/a")}"
  r << "Prism.singleton_methods.sort: #{Prism.singleton_methods.sort.first(30).inspect}"
rescue Exception => e
  r << "require prism: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "prism-parse",
    group: "B. 型推論の材料",
    label: "Prism のエラー耐性パースとスコープ情報",
    question: "論点2 選択肢B のスコープ情報 (有効な local variable) を取れるか",
    code: String.raw`
require "prism"
src = <<~'RB'
  a = 1
  b = "x"
  def foo(p1, p2)
    c = 2
    c.
  end
  [1, 2].each do |i|
    d = i
  end
RB
res = Prism.parse(src)
r = []
r << "result: #{res.class}"
r << "success?: #{res.success?}"
r << "errors: #{res.errors.map { |e| e.message }.inspect}"
prog = res.value
r << "program: #{prog.class}"
r << "program.locals: #{prog.locals.inspect}"
defn = prog.statements.body.find { |n| n.class.name.include?("DefNode") }
if defn
  r << "def.name: #{defn.name.inspect}"
  r << "def.locals: #{defn.locals.inspect}"
  r << "def.location offsets: #{[defn.location.start_offset, defn.location.end_offset].inspect}"
  r << "def.location lines: #{[defn.location.start_line, defn.location.end_line].inspect}"
end
call = prog.statements.body.find { |n| n.class.name.include?("CallNode") }
if call
  blk = call.block
  r << "block: #{blk.class}"
  r << "block.locals: #{(blk.respond_to?(:locals) ? blk.locals.inspect : "n/a")}"
end
r.join("\n")
`,
  },
  {
    id: "prism-cursor",
    group: "B. 型推論の材料",
    label: "Prism で「カーソル位置で有効な local variable」を引けるか",
    question: "論点2 選択肢B が実際に成立するか (offset -> スコープ解決)",
    code: String.raw`
require "prism"
src = <<~'RB'
  outer = 1
  def foo(p1)
    inner = 2
    inner.
  end
RB
cursor = src.index("inner.") + "inner.".length
res = Prism.parse(src)
scopes = []
visit = nil
visit = lambda do |node|
  return unless node.is_a?(Prism::Node)
  if node.respond_to?(:locals) && node.location.start_offset <= cursor && cursor <= node.location.end_offset
    scopes << [node.class.name, node.locals]
  end
  node.compact_child_nodes.each { |c| visit.call(c) }
end
visit.call(res.value)
r = []
r << "cursor offset: #{cursor}"
r << "enclosing scopes with locals: #{scopes.inspect}"
r << "visible locals at cursor: #{scopes.flat_map { |(_, l)| l }.uniq.inspect}"
r.join("\n")
`,
  },
  {
    id: "ast-scope",
    group: "B. 型推論の材料",
    label: "RubyVM::AbstractSyntaxTree のスコープ情報と位置情報",
    question: "既知の可用パーサ (ADR-0015) だけでスコープ情報が取れるか",
    code: String.raw`
src = <<~'RB'
  a = 1
  b = "x"
  def foo(p1, p2)
    c = 2
  end
  [1, 2].each do |i|
    d = i
  end
RB
n = RubyVM::AbstractSyntaxTree.parse(src)
r = []
r << "AST singleton_methods: #{RubyVM::AbstractSyntaxTree.singleton_methods.sort.inspect}"
r << "root: #{n.type} loc=#{[n.first_lineno, n.first_column, n.last_lineno, n.last_column].inspect}"
r << "root children[0] (local table): #{n.children[0].inspect}"
acc = []
walk = nil
walk = lambda do |node, depth|
  return if depth > 5
  line = ("  " * depth) + "#{node.type} #{[node.first_lineno, node.first_column, node.last_lineno, node.last_column].inspect}"
  line += " locals=#{node.children[0].inspect}" if node.type == :SCOPE
  acc << line
  node.children.each { |c| walk.call(c, depth + 1) if c.is_a?(RubyVM::AbstractSyntaxTree::Node) }
end
walk.call(n, 0)
r << acc.join("\n")
r.join("\n")
`,
  },
  {
    id: "ast-tolerant",
    group: "B. 型推論の材料",
    label: "RubyVM::AbstractSyntaxTree.parse の error_tolerant / keep_script_lines",
    question: "ADR-0015 の末尾バランス走査フォールバックを不要にできるか",
    code: String.raw`
r = []
complete = "a = 1\nfoo.ba"
incomplete = "def foo\n  x = 1\n  x."
[["complete plain", complete, {}],
 ["complete error_tolerant", complete, { error_tolerant: true }],
 ["complete keep_script_lines", complete, { keep_script_lines: true }],
 ["incomplete plain", incomplete, {}],
 ["incomplete error_tolerant", incomplete, { error_tolerant: true }]].each do |label, src, kw|
  begin
    n = RubyVM::AbstractSyntaxTree.parse(src, **kw)
    r << "#{label}: ok root=#{n.type} children=#{n.children.size}"
  rescue Exception => e
    r << "#{label}: #{e.class}: #{e.message.to_s.lines.first.to_s.strip}"
  end
end
r.join("\n")
`,
  },
  {
    id: "ast-tolerant-scope",
    group: "B. 型推論の材料",
    label: "タイピング中の未完成バッファから、カーソル位置のスコープを引けるか",
    question: "論点2 選択肢B が RubyVM::AbstractSyntaxTree だけで成立するか",
    code: String.raw`
src = <<~'RB'
  outer = 1
  helper = ->(x) { x }
  def foo(p1)
    inner = 2
    inner.
RB
r = []
n = RubyVM::AbstractSyntaxTree.parse(src, error_tolerant: true, keep_script_lines: true)
r << "parsed incomplete buffer: root=#{n.type} loc=#{[n.first_lineno, n.last_lineno].inspect}"
cursor_line = 5
enclosing = []
walk = nil
walk = lambda do |node|
  covers = node.first_lineno <= cursor_line && cursor_line <= node.last_lineno
  enclosing << [node.type, node.children[0]] if covers && node.type == :SCOPE
  node.children.each { |c| walk.call(c) if c.is_a?(RubyVM::AbstractSyntaxTree::Node) }
end
walk.call(n)
r << "SCOPE nodes covering line #{cursor_line}: #{enclosing.inspect}"
r << "visible locals at cursor: #{enclosing.flat_map { |(_, l)| l }.uniq.inspect}"
last = nil
find_last = nil
find_last = lambda do |node|
  last = node if node.last_lineno == cursor_line
  node.children.each { |c| find_last.call(c) if c.is_a?(RubyVM::AbstractSyntaxTree::Node) }
end
find_last.call(n)
r << "deepest node ending on the cursor line: #{last && [last.type, last.first_column, last.last_column].inspect}"
r << "source slice available (keep_script_lines): #{(n.script_lines ? n.script_lines.inspect : "nil")}"
r.join("\n")
`,
  },

  // ------------------------------------- C. 候補生成の足回り (論点1 / 論点2)
  {
    id: "binding",
    group: "C. 候補生成の足回り",
    label: "Binding#local_variables ほか",
    question: "評価コンテキストから local variable を列挙できるか",
    code: String.raw`
r = []
r << "Binding.instance_methods(false).sort: #{Binding.instance_methods(false).sort.inspect}"
r << eval(<<~'RB')
  aa = 1
  bb = "two"
  bnd = binding
  [
    "local_variables=#{bnd.local_variables.inspect}",
    "local_variable_get(:aa)=#{bnd.local_variable_get(:aa).inspect}",
    "local_variable_defined?(:bb)=#{bnd.local_variable_defined?(:bb)}",
    "receiver=#{bnd.receiver.inspect}",
  ].join("; ")
RB
r << "TOPLEVEL_BINDING.local_variables: #{TOPLEVEL_BINDING.local_variables.inspect}"
b2 = binding
b2.local_variable_set(:injected, 42)
r << "local_variable_set then get: #{b2.local_variable_get(:injected).inspect}"
r.join("\n")
`,
  },
  {
    id: "reflection",
    group: "C. 候補生成の足回り",
    label: "Module#instance_methods / 定数 / シグネチャ",
    question: "反射問い合わせでメソッド集合と引数情報を引けるか",
    code: String.raw`
r = []
r << "String.instance_methods(false).size: #{String.instance_methods(false).size}"
r << "String.instance_methods.size: #{String.instance_methods.size}"
r << "Integer.instance_methods.size: #{Integer.instance_methods.size}"
r << "Array.instance_methods.size: #{Array.instance_methods.size}"
r << "String.instance_methods.grep(/^up/).sort: #{String.instance_methods.grep(/^up/).sort.inspect}"
r << "String.instance_method(:sub).parameters: #{String.instance_method(:sub).parameters.inspect}"
r << "String.instance_method(:sub).arity: #{String.instance_method(:sub).arity}"
r << "String.instance_method(:sub).source_location: #{String.instance_method(:sub).source_location.inspect}"
r << "String.instance_method(:sub).owner: #{String.instance_method(:sub).owner}"
r << "Object.constants.size: #{Object.constants.size}"
r << "Object.constants.grep(/^Str/): #{Object.constants.grep(/^Str/).inspect}"
r << "Kernel.private_instance_methods(false).size: #{Kernel.private_instance_methods(false).size}"
r.join("\n")
`,
  },
  {
    id: "reflection-cost",
    group: "C. 候補生成の足回り",
    label: "反射問い合わせのコスト",
    question: "候補生成そのものはレイテンシ予算のどれくらいを食うか",
    code: String.raw`
def bench(n)
  t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  n.times { yield }
  ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000.0 / n)
end
r = []
r << "String.instance_methods.grep: #{"%.4f" % bench(200) { String.instance_methods.grep(/^up/) }} ms/call"
r << "Array.instance_methods: #{"%.4f" % bench(200) { Array.instance_methods }} ms/call"
r << "Object.constants: #{"%.4f" % bench(200) { Object.constants }} ms/call"
r << "ObjectSpace.each_object(Class).count: #{"%.4f" % bench(5) { ObjectSpace.each_object(Class).count }} ms/call"
r.join("\n")
`,
  },
  {
    id: "objectspace",
    group: "C. 候補生成の足回り",
    label: "ObjectSpace の可用性",
    question: "定義済みクラスの列挙などをライブ VM から引けるか",
    code: String.raw`
r = []
r << "defined?(ObjectSpace): #{defined?(ObjectSpace).inspect}"
r << "ObjectSpace.singleton_methods.sort: #{ObjectSpace.singleton_methods.sort.inspect}"
begin
  r << "each_object(Class).count: #{ObjectSpace.each_object(Class).count}"
rescue Exception => e
  r << "each_object(Class): #{e.class}: #{e.message}"
end
begin
  r << "each_object(Module).count: #{ObjectSpace.each_object(Module).count}"
rescue Exception => e
  r << "each_object(Module): #{e.class}: #{e.message}"
end
begin
  require "objspace"
  r << "require objspace: ok"
  r << "ObjectSpace.memsize_of('x'): #{ObjectSpace.memsize_of("x")}"
rescue Exception => e
  r << "require objspace: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },

  // ---------------------------------------------- A. 中断手段 (論点5 選択肢C)
  {
    id: "thread",
    group: "A. 中断手段",
    label: "Thread の可用性",
    question: "Timeout / 監視スレッド型の中断が土台から成立するか",
    timeoutMs: 10000,
    code: String.raw`
r = []
r << "defined?(Thread): #{defined?(Thread).inspect}"
begin
  t = Thread.new { 40 + 2 }
  r << "Thread.new(...).value: #{t.value}"
rescue Exception => e
  r << "Thread.new: #{e.class}: #{e.message}"
end
begin
  r << "Thread.list.size: #{Thread.list.size}"
  r << "Thread.current: #{Thread.current.inspect}"
rescue Exception => e
  r << "Thread.list: #{e.class}: #{e.message}"
end
begin
  flag = false
  t2 = Thread.new { sleep 0.05; flag = true }
  t2.join
  r << "Thread sleep+join, flag=#{flag}"
rescue Exception => e
  r << "Thread sleep+join: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "timeout-require",
    group: "A. 中断手段",
    label: "Timeout モジュールの存在",
    question: "論点5 選択肢C が挙げる Timeout がそもそも読み込めるか",
    code: String.raw`
r = []
begin
  require "timeout"
  r << "require timeout: ok"
rescue Exception => e
  r << "require timeout: #{e.class}: #{e.message}"
end
r << "defined?(Timeout): #{defined?(Timeout).inspect}"
begin
  r << "Timeout.singleton_methods.sort: #{Timeout.singleton_methods.sort.inspect}"
  r << "Timeout::VERSION: #{(defined?(Timeout::VERSION) ? Timeout::VERSION : "n/a")}"
rescue Exception => e
  r << "Timeout introspection: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "timeout-runtime",
    group: "A. 中断手段",
    label: "Timeout.timeout を実際に走らせる",
    question: "require できる Timeout が WASI で実際に発火するか (論点5 選択肢C)",
    hangRisk: true,
    isolate: true,
    timeoutMs: 15000,
    code: String.raw`
require "timeout"
r = []
t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
r << "sleep case: " + begin
  Timeout.timeout(0.3) { sleep 2 }
  "returned normally (NOT interrupted)"
rescue Timeout::Error
  "Timeout::Error raised"
rescue Exception => e
  "#{e.class}: #{e.message}"
end + " after #{((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round}ms"
t1 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
r << "busy loop case: " + begin
  Timeout.timeout(0.5) { i = 0; i += 1 while true }
  "returned normally"
rescue Timeout::Error
  "Timeout::Error raised"
rescue Exception => e
  "#{e.class}: #{e.message}"
end + " after #{((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t1) * 1000).round}ms"
r.join("\n")
`,
  },
  {
    id: "sleep-clock",
    group: "A. 中断手段",
    label: "sleep と単調時計",
    question: "経過時間を見て自前で打ち切る前提 (時計が動くこと) が成り立つか",
    timeoutMs: 10000,
    code: String.raw`
t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
slept = begin
  sleep 0.2
  "ok"
rescue Exception => e
  "#{e.class}: #{e.message}"
end
elapsed = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round
"sleep 0.2: #{slept}, monotonic clock advanced #{elapsed}ms"
`,
  },
  {
    id: "tracepoint-fuel-naive",
    group: "A. 中断手段",
    label: "TracePoint fuel (素朴版: ハンドラ内で raise するだけ)",
    question: "素朴な fuel 実装が永続 VM を汚さずに済むか",
    hangRisk: true,
    isolate: true,
    timeoutMs: 8000,
    code: String.raw`
count = 0
budget = 5000
tp = TracePoint.new(:line) { |_tp| count += 1; raise "fuel exhausted" if count > budget }
outcome =
  begin
    tp.enable
    i = 0
    while true
      i += 1
    end
    "loop returned"
  rescue Exception => e
    "rescued: #{e.class}: #{e.message}"
  ensure
    tp.disable
  end
"outcome: #{outcome} / line events: #{count}"
`,
  },
  {
    id: "tracepoint-fuel-oneshot",
    group: "A. 中断手段",
    label: "TracePoint fuel (自己武装解除版)",
    question: "スレッド非依存の Ruby 内在の中断手段が成立するか (論点5 選択肢C)",
    hangRisk: true,
    isolate: true,
    timeoutMs: 8000,
    code: String.raw`
class ProbeFuelExhausted < StandardError; end
r = []
r << "defined?(TracePoint): #{defined?(TracePoint).inspect}"
count = 0
budget = 5000
tp = TracePoint.new(:line) do |this|
  count += 1
  if count > budget
    this.disable
    raise ProbeFuelExhausted, "fuel exhausted at #{count} line events"
  end
end
t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
outcome =
  begin
    tp.enable
    i = 0
    while true
      i += 1
    end
    "loop returned"
  rescue ProbeFuelExhausted => e
    "interrupted cleanly: #{e.message}"
  rescue Exception => e
    "#{e.class}: #{e.message}"
  ensure
    tp.disable
  end
elapsed = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000).round
r << "outcome: #{outcome}"
r << "elapsed: #{elapsed}ms for #{count} line events"
r << "VM still usable after the interrupt? #{(1 + 1 == 2 ? "yes" : "no")}"
r << "TracePoint left enabled? #{tp.enabled?}"
r.join("\n")
`,
  },
  {
    id: "tracepoint-overhead",
    isolate: true,
    group: "A. 中断手段",
    label: "TracePoint を有効にしたままの実行コスト",
    question: "fuel 方式を常時オンにしたときレイテンシ予算に収まるか",
    timeoutMs: 20000,
    code: String.raw`
def spin(n)
  i = 0
  acc = 0
  while i < n
    acc += i
    i += 1
  end
  acc
end
n = 50_000
t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
spin(n)
plain = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0) * 1000
count = 0
tp = TracePoint.new(:line) { |_tp| count += 1 }
t1 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
tp.enable { spin(n) }
traced = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - t1) * 1000
"plain: #{"%.1f" % plain}ms / traced: #{"%.1f" % traced}ms (#{"%.1f" % (traced / plain)}x, #{count} line events)"
`,
  },
  {
    id: "signal-trap",
    isolate: true,
    group: "A. 中断手段",
    label: "Signal / trap による外部からの割り込み",
    question: "Worker の外から VM に割り込む口があるか",
    code: String.raw`
r = []
begin
  r << "Signal.list.size: #{Signal.list.size}"
  r << "Signal.list.keys.first(10): #{Signal.list.keys.sort.first(10).inspect}"
rescue Exception => e
  r << "Signal.list: #{e.class}: #{e.message}"
end
begin
  trap("INT") { }
  r << "trap INT: ok"
rescue Exception => e
  r << "trap INT: #{e.class}: #{e.message}"
end
begin
  r << "Process.pid: #{Process.pid}"
  r << "Process.kill(0, Process.pid): #{Process.kill(0, Process.pid)}"
rescue Exception => e
  r << "Process.kill: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "ractor",
    isolate: true,
    group: "A. 中断手段",
    label: "Ractor による隔離実行",
    question: "評価を隔離して捨てられる単位が VM 内にあるか (論点4/5)",
    hangRisk: true,
    timeoutMs: 8000,
    code: String.raw`
r = []
r << "defined?(Ractor): #{defined?(Ractor).inspect}"
begin
  ra = Ractor.new { 1 + 1 }
  v = ra.respond_to?(:value) ? ra.value : ra.take
  r << "Ractor.new(...) value: #{v}"
rescue Exception => e
  r << "Ractor.new: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "js-bridge",
    group: "A. 中断手段",
    label: "js gem (Ruby から JS への橋) の可用性",
    question: "JS 側主導で評価を止める/やり直す口があるか",
    code: String.raw`
r = []
begin
  require "js"
  r << "require js: ok"
  # NB: JS::Object forwards unknown methods to the JS side, so calling #class
  # on it asks JavaScript for a "class" property. Use typeof/inspect instead.
  r << "JS.global.typeof: #{JS.global.typeof}"
  r << "JS.global[:performance].typeof: #{JS.global[:performance].typeof}"
  r << "JS.global[:performance].call(:now).typeof: #{JS.global[:performance].call(:now).typeof}"
  r << "JS::Object.instance_methods(false).sort: #{JS::Object.instance_methods(false).sort.inspect}"
  r << "JS.global.respond_to?(:await): #{JS.global.respond_to?(:await)}"
rescue Exception => e
  r << "require js: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
  {
    id: "gc-and-fork",
    isolate: true,
    group: "A. 中断手段",
    label: "GC.compact / fork / snapshot 系",
    question: "VM を作り直さずに状態を巻き戻す手段があるか (論点4/6)",
    code: String.raw`
r = []
begin
  r << "GC.stat[:count]: #{GC.stat[:count]}"
  r << "GC.compact: #{(GC.compact ? "ok" : "nil")}"
rescue Exception => e
  r << "GC: #{e.class}: #{e.message}"
end
begin
  pid = fork { }
  r << "fork: returned #{pid.inspect}"
rescue Exception => e
  r << "fork: #{e.class}: #{e.message}"
end
begin
  r << "Process.respond_to?(:fork): #{Process.respond_to?(:fork)}"
  r << "Process.clock_gettime available: #{Process.clock_gettime(Process::CLOCK_MONOTONIC).class}"
rescue Exception => e
  r << "Process: #{e.class}: #{e.message}"
end
r.join("\n")
`,
  },
];
