# 公式参照の監査記録

2026-10-28、学習順序を再構成した23レッスンを対象に再監査。参照の選び方・版追加の規則の正本は[リポジトリ内スキル](../.agents/skills/ruby-tutorial-authoring/references/releases-and-references.md)。この文書は今回の観察結果を記録する。

## 修正した対応

| 教材 | 確認結果と修正 |
| --- | --- |
| output | Kernel#puts / Kernel#pは主題に対応。本文で説明するコメントについてCommentsを追加。以前のCode Layoutへの主参照は現在使っていない。 |
| conditionals | Operatorsは主に演算子のメソッド定義や論理演算の説明。数値の比較の直接的な根拠としてIntegerへ置換し、分岐はControl Expressionsを維持。 |
| classes | Modules and Classesだけではnewによるinitialize呼び出しの説明が不足。Class#newを追加し、属性リーダーをModule#attr_readerのアンカーへ具体化。 |
| special-forms | Miscellaneousはalias・undef・BEGIN・ENDを含む正しい参照。alias後の再定義の応用を補うためModule#alias_methodも追加。 |

根拠:

- [Integerの比較](https://docs.ruby-lang.org/en/4.0/Integer.html)、[Control Expressions](https://docs.ruby-lang.org/en/4.0/syntax/control_expressions_rdoc.html)
- [Class#new](https://docs.ruby-lang.org/en/4.0/Class.html#method-i-new)、[Module#attr_reader](https://docs.ruby-lang.org/en/4.0/Module.html#method-i-attr_reader)
- [Miscellaneous](https://docs.ruby-lang.org/en/4.0/syntax/miscellaneous_rdoc.html)、[Module#alias_method](https://docs.ruby-lang.org/en/4.0/Module.html#method-i-alias_method)

## 主題との対応

| 教材 | 対応する主な公式資料 |
| --- | --- |
| variables | Assignmentのローカル変数・代入 |
| values | Literals、Integer/Floatの演算、Precedence |
| strings / symbols | Literals、String、Symbolの変換・比較メソッド |
| booleans | Control Expressionsのtruthiness、BasicObjectの否定、NilClass等 |
| loops | Control Expressionsのwhile/until/break/next |
| collections / hashes / ranges | Array、Hash、Rangeの添字・更新・存在確認・境界判定 |
| methods / blocks | MethodsとCalling Methodsの引数・戻り値・yield・ブロック |
| enumerable | Enumerable/Arrayのeach・map・select、Calling Methods。itの導入時期は明示した3.4 NEWS |
| inheritance / modules | Modules and Classesの継承・super・include。superの根拠はこの章でありCalling Methodsだけではない |
| operator-methods | MethodsとOperatorsの演算子メソッド定義。3.2ではMethodsへの版別対応 |
| exceptions | Exceptionsのrescue/else/ensure、KernelのInteger/raise |
| pattern-matching | Pattern matchingのハッシュパターン・追加キー・ガード |
| callables | Procのcall・クロージャ・lambdaとの引数/returnの違い |
| refinements | Refinementsのusingと字句スコープ |

主題の対応は3.2・4.0の本文を中心に確認し、itの導入は3.4 NEWSで確認した。全5版の公式マニュアル全文を比較したという意味ではない。リンク到達性・アンカーは生成した全版を別途検証する。Workerの終了とENDの違いはRuby公式資料だけでは裏付けられず、実装と既存WASM実行結果を根拠とする。

## バージョンの対応

アプリ・教材が参照する共通カタログは`src/versions.ts`。3.2/3.3/3.4/4.0は同じ版の公式名前空間、4.1開発版はmasterを参照する。教材専用のバージョンJSONは廃止した。3.4 NEWSへのリンクは機能の導入時期を示すための例外で、選択中の版のマニュアルだと誤認させない表示にしている。

## 実行結果

修正後の全5版から抽出した155個の公式URLはHTTP 200。メソッドリンクはアンカー存在も確認した。ユーザー用プレビュー18890でClass#newのリンクが4.0/3.2/masterへ版に応じて変わることを確認。共通版定義への移行後、ブラウザ127件（全教材の実行とアプリ・教材の版一致を含む）が成功した。
