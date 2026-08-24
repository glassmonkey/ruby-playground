# ADR-0018: コード補完の設計判断が依存する ruby.wasm 能力の先行調査結果

## Status

Accepted (2026-08-24)

## Context

[issue #29](https://github.com/glassmonkey/ruby-playground/issues/29) の論点7 (設計判断が依存する`ruby.wasm`の能力を、いつ確認するか) について、選択肢A「先行 — 設計判断の前に能力調査だけを独立させる」を実行した。#13 のspike ([ADR-0015](0015-completion-spike-result.md)) が「`Ripper`が使える前提で検証項目を組み、実装時に不在が判明して方式ごと組み替えになった」失敗を繰り返さないためである。

**本ADRは事実の記録に徹する。issue #29 の論点1〜7 の選択 (収束) は本ADRでは行わない。**

調査コードは`frontend/spike/capability-probe.js` (ドライバ) / `capability-probes.js` (プローブ本体) / `capability-probe.worker.js` (VMを持つWorker) に置き、`node frontend/spike/build.mjs`でビルドして実ブラウザのWeb Workerで実行した。プローブは永続VMに対して順に投げ、VMを恒久的に壊しうるものはWorkerごと捨てて次に進む構成にしている (この構成自体が後述の検証1-3 で必要になった)。

測定環境: Chrome 151 (macOS 15)、ローカル静的サーバ配信、`@ruby/4.0-wasm-wasi` 2.10.1、`ruby 4.0.0 (2025-12-25 revision 553f1675f3) +PRISM [wasm32-wasi]`。数値は複数回実行のレンジで示す。

### 検証0: 調査対象のwasmビルドが1つではなかった (事実)

`@ruby/4.0-wasm-wasi` 2.10.1 の`dist/`には3つのwasmが同梱されている。

- `ruby.wasm` — 17,219,023 bytes。stdlibを含まない
- `ruby+stdlib.wasm` — 32,555,374 bytes。stdlibを含む
- `ruby.debug+stdlib.wasm` — 53,237,719 bytes

`frontend/build.mjs`がコピーして配信しているのは`ruby.wasm` (stdlibなし) である。実測した中身の差:

- `ruby.wasm`: `rubylibdir` (`/usr/local/lib/ruby/4.0.0`) 配下は2エントリ (`wasm32-wasi`のみ)、トップレベルの`.rb`は0個。`$LOAD_PATH`に載る gem は test-unit / power_assert / logger / js の4つだけ。`/usr/local/lib/ruby/gems`ディレクトリ自体が存在しない
- `ruby+stdlib.wasm`: `rubylibdir`配下981エントリ、トップレベルの`.rb` 45個、サブディレクトリ24個。`/usr/local/lib/ruby/gems/4.0.0/gems`に74個のgemが実在する

以降の検証結果は、この2ビルドで大きく異なる。本ADRでは両方を測った。

なお[ADR-0014](0014-wasm-bundle-build-and-hosting.md)の本文は「`ruby+stdlib.wasm`本体」を配信対象として記述しているが、実装は`ruby.wasm`を配信している。この不一致は事実として記録するにとどめ、どちらに揃えるかは本ADRでは決めない。

### 検証1: 中断手段 (事実) — issue #29 論点5 選択肢C が依存

#### 1-1. wasmランタイム層の中断機構は存在しない

- ブラウザの`WebAssembly` APIには wasmtime の fuel / epoch interruption に相当するものがない。これは仕様上の事実であり実測対象外
- `@ruby/wasm-wasi` 2.10.1 の公開API (`RubyVM`, `DefaultRubyVM`) にも中断系のメソッドは存在しない (`dist/esm/vm.d.ts`に interrupt / fuel / epoch / timeout に相当するものなし)
- したがってJS側からVMを止める手段は`worker.terminate()`のみ

#### 1-2. スレッドに依存する中断は全て成立しない

両ビルド共通で、以下はすべて`NotImplementedError`になる。

- `Thread.new { 40 + 2 }` → `NotImplementedError: initialize() function is unimplemented on this machine`。`Thread.current`と`Thread.list` (size 1) は取れるが、新規スレッドは作れない
- `Ractor.new { 1 + 1 }` → `NotImplementedError: new() function is unimplemented on this machine`
- `fork` → `NotImplementedError`。`Process.respond_to?(:fork)`は`false`
- `GC.compact` → `NotImplementedError`

`Timeout`については両ビルドで挙動が分かれるが、結論は同じ。

- `ruby.wasm`: `require "timeout"` が`LoadError`。モジュールが存在しない
- `ruby+stdlib.wasm`: `require "timeout"` は成功し`Timeout::VERSION`は`0.6.0`。しかし実際に`Timeout.timeout(0.3) { sleep 2 }`を走らせると12msで`NotImplementedError: initialize() function is unimplemented on this machine`、`Timeout.timeout(0.5) { i = 0; i += 1 while true }`も1msで同じ例外。`Timeout`は内部で監視スレッドを立てるため、1-2 のスレッド不在に帰着する

`Signal.list`は34エントリ返り`trap("INT") { }`も成功するが、`Process.kill(0, Process.pid)`は`Errno::ENOTSUP`。外部からシグナルで割り込む経路も無い。

#### 1-3. TracePoint による fuel 相当の中断は成立する。ただし実装を誤ると永続VMを恒久破壊する

`TracePoint`は両ビルドで利用可能。`:line`イベントを数えて予算超過で例外を投げる「fuel」は実際に無限ループを中断できた。ただし2つの実装を比べると挙動が決定的に違う。

素朴版 — ハンドラ内で単に`raise`する:

```ruby
tp = TracePoint.new(:line) { |_tp| count += 1; raise "fuel exhausted" if count > budget }
begin
  tp.enable
  i = 0
  while true
    i += 1
  end
rescue Exception => e
  "rescued: #{e.class}"
ensure
  tp.disable
end
```

これは失敗する。例外は`rescue`節に入るが、`rescue`節と`ensure`節の各行でも`:line`イベントが発火し`count > budget`が成立し続けるため、ハンドラが再度raiseして`rescue`/`ensure`を貫通し、evalの外へ抜ける。`ensure`の`tp.disable`は実行されない。結果、**そのVMに対する以降のすべてのevalが`fuel exhausted`で失敗し続ける**。`ruby+stdlib.wasm`では例外整形自体が壊れ`Unexpected exception occurred during formatting exception message`になる。復旧手段は`worker.terminate()`のみ。

自己武装解除版 — ハンドラ内で自分を`disable`してからraiseする:

```ruby
tp = TracePoint.new(:line) do |this|
  count += 1
  if count > budget
    this.disable
    raise ProbeFuelExhausted, "fuel exhausted at #{count} line events"
  end
end
```

こちらは成功する。実測: 5001 line events を消費して159〜205msで中断し、`rescue ProbeFuelExhausted`で正常に捕捉、中断後も同じVMで`1 + 1`が通り、`tp.enabled?`は`false`。VMは生き残る。

常時オンにしたときのコストも測った。同じ100,005 line events のループで、TracePoint無効時 38.4〜45.0ms に対し有効時 1072〜1514ms。**23.8〜34.1倍の減速**である。

その他:

- `sleep 0.2`は動作し、`Process.clock_gettime(Process::CLOCK_MONOTONIC)`も201〜210ms進む。経過時間を自前で見て打ち切る方式の前提 (時計が動くこと) は満たされる。ただし打ち切りの実行主体はRuby側にしか置けないため、1-3 のTracePointか、評価対象コードへの計装のどちらかが要る
- `js` gemは両ビルドで`require`可能。`JS::Object`には`await`があり (Asyncify経由)、Ruby側からJSのイベントループへ制御を戻せる。ただしこれは「Rubyが自発的に譲る」経路であり、JS側から強制的に奪う経路ではない

### 検証2: 型推論の材料 (事実) — issue #29 論点3 選択肢B / 論点2 選択肢B が依存

#### 2-1. RBS はどちらのビルドにも無い

- 両ビルドで`require "rbs"`は`LoadError`。`defined?(RBS)`は`nil`
- `ruby+stdlib.wasm`のディスク上に実在する74 gem を全部数えたが、その中に`rbs`は無い。`$LOAD_PATH`に74 gem すべての`lib`を追加してから`require "rbs"`しても`LoadError`
- `.rbs`ファイルは`/usr/local`配下に5個しかない (`base64`, `mutex_m`, `prime`×2, `repl_type_completor`)。RBSのcore signature (通常数百ファイル) は存在しない
- `typeprof-0.31.1` と `repl_type_completor-0.1.12` はディスク上に実在する。しかし両方 rbs 依存のため`require`は`LoadError: cannot load such file -- rbs`で失敗する。IRB の型ベース補完エンジンをそのまま載せることは、現状のバンドルのままでは不可
- `rubygems`自体も機能していない。`Gem.loaded_specs`は`NoMethodError`、`Gem::Specification`は`NameError` (両ビルド)

#### 2-2. Prism は stdlib ビルドにのみ在る

- `ruby.wasm`: `require "prism"`は`LoadError`。ただし`RUBY_DESCRIPTION`は`+PRISM`であり、**パーサとしてのPrismはCRubyに組み込まれているが、Rubyから触れるライブラリとしてのPrismは同梱されていない**
- `ruby+stdlib.wasm`: `require "prism"`成功、`Prism::VERSION`は`1.7.0`。初回requireに475〜1169msかかる (以降は不要)

stdlibビルドでのPrismの実測:

- `Prism.parse`はエラー耐性がある。`def`の`end`が無い未完成バッファに対し`success? == false`かつ`errors`にメッセージを持ちながら、`Prism::ProgramNode`を返す
- `ProgramNode#locals` → `[:a, :b]`、`DefNode#locals` → `[:p1, :p2, :c]`。スコープごとのローカル変数表が取れる
- `Location#start_offset` / `end_offset` / `start_line` / `end_line` があり、カーソルのバイトオフセットからスコープを引ける
- 実測: `outer = 1 / def foo(p1) / inner = 2 / inner.` という未完成バッファでカーソルを`inner.`直後に置き、offsetを含む`locals`持ちノードを辿って`[:outer, :p1, :inner]`を得た。所要4.3〜11.0ms

#### 2-3. Ripper の可用性は ADR-0015 の記述どおりだが、その原因はビルド選択だった

- `ruby.wasm`: `Ripper.singleton_methods`は`[:dedent_string, :lex_state_name]`。`Ripper.lex`も`Ripper.sexp`も`NoMethodError`。**ADR-0015 検証1 の観察と完全に一致する**
- `ruby+stdlib.wasm`: `Ripper.singleton_methods`は`[:dedent_string, :lex, :lex_state_name, :parse, :sexp, :sexp_raw, :slice, :token_match, :tokenize]`。`Ripper.lex("a.up")`も`Ripper.sexp("a.up")`も正常に動く

つまり ADR-0015 の「`ruby.wasm`では`Ripper`が使えない」という事実は、`ruby.wasm`という**特定のバンドル選択の帰結**であって、ruby.wasm一般の制約ではなかった。

ただし`Ripper.sexp("a.")` (未完成) は`nil`を返す。Ripperにエラー耐性は無く、タイピング中のバッファをそのまま食わせる用途には向かない。

#### 2-4. RubyVM::AbstractSyntaxTree だけでスコープ情報が取れる (両ビルド)

`RubyVM::AbstractSyntaxTree`は両ビルドで利用可能。`singleton_methods`は`[:node_id_for_backtrace_location, :of, :parse, :parse_file]`。

ADR-0015 では触れられていなかったが、以下が実測できた。

- **`error_tolerant: true`が効く**。`"def foo\n  x = 1\n  x."`はデフォルトでは`SyntaxError: syntax error, unexpected end-of-input, expecting '('`だが、`error_tolerant: true`ではSCOPEノードを返す。ADR-0015 が実装した「末尾のバランス走査で候補式を切り出して再パース」という自前フォールバックは、この引数で代替できる可能性がある
- **SCOPEノードの`children[0]`がローカル変数表**。`def foo(p1, p2); c = 2; end`のSCOPEは`[:p1, :p2, :c]`、`[1,2].each do |i| d = i end`のSCOPEは`[:i, :d]`、トップレベルは`[:a, :b]`
- 全ノードに`first_lineno` / `first_column` / `last_lineno` / `last_column`がある
- `keep_script_lines: true`で`node.script_lines`からソース行が取れる
- 実測: `outer = 1 / helper = ->(x) { x } / def foo(p1) / inner = 2 / inner.` という未完成バッファを`error_tolerant: true, keep_script_lines: true`でパースし、カーソル行 (5行目) を含むSCOPEを辿って`[:outer, :helper, :p1, :inner]`を得た。所要4.3〜16.1ms。カーソル行で終わる最深ノードは`ERROR`型として位置つきで取れる

要するに、issue #29 の論点2 選択肢B が求める「カーソル位置で有効なlocal variable名の一覧」は、**stdlibビルドに切り替えなくても、コードを一切実行せずに、5〜16msで取得できる**。

### 検証3: 候補生成の足回り (事実) — issue #29 論点1 / 論点2 が依存

両ビルドで利用可能。

- `Binding`: `local_variables`, `local_variable_get`, `local_variable_set`, `local_variable_defined?`, `receiver`, `eval`, `source_location` がすべて動作
- `Module#instance_methods`: 動作。`String` 182個、`Integer` 137個、`Array` 187個。`String.instance_methods.grep(/^up/)`は0.35〜1.00 ms/call
- `Object.constants`は116〜118個で0.08〜0.14 ms/call
- `UnboundMethod#parameters` / `#arity` / `#owner`は動作するが、**C実装のメソッドは引数名が取れない**。`String.instance_method(:sub).parameters`は`[[:rest]]`、`source_location`は`nil`。シグネチャヒント用途には情報が足りない
- `ObjectSpace`: `each_object`, `count_objects`, `_id2ref`, `define_finalizer`等が利用可能。`each_object(Class).count`は`ruby.wasm`で248、stdlibビルドで581、1.6〜3.2 ms/call。`require "objspace"`も成功し`memsize_of`も動く

候補生成そのもののコストは1ms前後で、レイテンシ予算上の主要因ではない。

### 検証4: VMライフサイクルの実測 (事実) — issue #29 論点5 選択肢A / 論点6 が依存

`ruby.wasm` (17.2MB):

- 初回: fetch 29.8〜63.4ms、`WebAssembly.compile` 21.9〜75.0ms、`DefaultRubyVM` (VM初期化) 586〜703ms、Worker生成からready までのメインスレッド実測 827〜896ms
- `terminate()`して新しいWorkerを立て直したとき (wasmはHTTPキャッシュ済み): 708〜1009ms

`ruby+stdlib.wasm` (32.5MB):

- 初回: fetch 155〜292ms、compile 68〜84ms、VM初期化 586〜892ms、wall 1022〜1217ms
- terminate後の立て直し: 785〜1327ms

同一Worker内で、すでにコンパイル済みの`WebAssembly.Module`から2個目のVMを作る場合: 180〜602ms。

ウォーム状態の`vm.eval("1 + 1")`: 平均0.7〜0.9ms、最大4.4〜7.0ms。

重要な点は、**再初期化コストの支配項がfetchでもcompileでもなくVM初期化 (586〜892ms) だということ**である。wasmをHTTPキャッシュに載せても、コンパイル済みModuleを使い回しても、1回のVM作り直しは数百ms〜1秒級から下がらない。ADR-0015 が記録した「約880msの再初期化コスト」は追認され、かつ「キャッシュで安くなる類のコストではない」ことが分かった。

### 検証5: JS側からWASI仮想FSへファイルを注入できる (事実)

`DefaultRubyVM`は`/`を空のin-memory `PreopenDirectory`としてmountしているだけである (`@ruby/wasm-wasi/dist/esm/browser.js`)。`RubyVM.instantiateModule({ module, wasip1 })`に自前の`WASI`インスタンスを渡せば、任意のディレクトリとファイルをVMに見せられる。

実測: `/mnt`に502ファイル (うち`.rbs`が501個) をmountしてVMを起動したところ、

- `Dir.entries('/mnt').size` → 504
- `File.read('/mnt/hello.rbs')` → 内容が正しく読める
- `$LOAD_PATH.unshift('/mnt')`してから`require 'injected'` → 成功
- `Dir.glob('/mnt/**/*.rbs').size` → 501
- VM構築+mount 223〜910ms、上記プローブevalが30〜251ms

つまり、バンドルに入っていないpure RubyのライブラリやRBSのsignatureファイルを、**wasmを再ビルドせずJS側から供給する経路は存在する**。ファイル数によるmountコストの増分は、VM初期化時間の分散に埋もれる程度だった。

### 検証6: 副次観察 (事実)

永続VMに連続でevalを投げると、`TOPLEVEL_BINDING.local_variables`が実行のたびに増えていく (前のevalの局所変数が残る)。ADR-0015 検証3-1 が実証したグローバル変数の単調増加と同じ現象が、ローカル変数のレベルでも起きている。永続VMの状態汚染は「グローバル変数を書くコードを書いたときだけ起きる」ものではない。

## Decision

**本ADRは事実の記録であり、issue #29 の論点1〜7 のいずれについても選択を行わない。** 収束はissue #29 上でuserが行う。

本ADRが確定させるのは次の2点のみ。

1. issue #29 論点7 の選択肢A (設計判断の前に能力調査を独立させる) を、本タスクの範囲で実行した。上記の検証0〜6 がその成果であり、論点1〜7 の評価はこの事実集合を入力として行う
2. ADR-0015 検証1 の記述「`@ruby/4.0-wasm-wasi` 2.10.1 の`ruby.wasm`では`Ripper.lex`/`Ripper.sexp`が未実装」は、観察としては正しいが、**原因は同パッケージ内のstdlib無しビルドを配信していることであり、ruby.wasm一般の制約ではない**。ADR-0015 の最終判定 (ライブVM反射問い合わせ方式はfail) 自体は本ADRでは覆さない

## Consequences

- issue #29 の論点1〜7 の評価は、本ADRの検証0〜6 を事実の出発点として行える。特に次の4点は、issue #29 起票時点では未確認だったために選択肢の記述が能力を仮定したままになっていた箇所を確定させる
  - 論点5 選択肢C が挙げる「fuel / epoch interruption」はブラウザに存在せず、「`Timeout`」はスレッド不在により両ビルドで成立しない。同選択肢に残るのはTracePointによるfuelのみで、それには23.8〜34.1倍の実行時オーバーヘッドと、実装を誤ると永続VMを恒久破壊するという条件が付く
  - 論点3 選択肢B が前提にしうるRBSは、どちらのwasmビルドにも同梱されていない。使うなら検証5 の経路で自前供給する追加作業が要る
  - 論点2 選択肢B が求めるスコープ情報は、`RubyVM::AbstractSyntaxTree`の`error_tolerant: true`だけで、コードを実行せずに5〜16msで取得できる。stdlibビルドへの切り替えもPrismも必須ではない
  - 論点5 選択肢A / 論点6 選択肢B のコストである「VM作り直し」は、キャッシュやコンパイル済みModuleの再利用では安くならない (支配項がVM初期化の586〜892ms)
- 配信しているwasmが`ruby.wasm` (stdlibなし) であり、ADR-0014 本文の記述 (`ruby+stdlib.wasm`) と食い違っている。バンドルサイズ17.2MB→32.5MB と引き換えに Prism / Ripper / timeout / 74 gem が入るというトレードオフになる。これは補完の設計判断とは独立に決めるべき事項であり、本ADRでは決めない
- 調査コードは`frontend/spike/`に残す。`frontend/src/`はTypeScript化 (#23) の対象であり、使い捨てのspikeコードをそこに置かないため、既存の`completion-worker.spike.js`も同ディレクトリへ移した。`frontend/build.mjs`のentryPointsからは外してあり、アプリのビルド成果物には含まれない。`node frontend/spike/build.mjs`でのみビルドされ、出力先は gitignore 済みの`public/ruby-wasm/spike/`
- 本ADRの数値はChrome 151 / macOS の1台での実測である。桁が変わるような差は他環境でも出ないと考えるが、絶対値をSLAとして扱わない
