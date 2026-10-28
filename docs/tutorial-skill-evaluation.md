# チュートリアル教材の評価記録

## 結論

監査中に見つけた UI 説明と残り項目表示の2点は、教材本文と生成 UI の修正で解消しました。`output` と `blocks` の実例は実 WASM で確認した範囲で期待出力と一致します。`blocks` は目標と課題の対応に改善余地がありますが、正確性の blocker は残っていません。

## 根拠と判定

### 解消済み: `output` の実行操作の説明

監査時点では `output.paragraphs[0]` が編集時に自動実行すると説明していましたが、[TutorialPlayground 実装](../src/tutorial-playground.tsx)は **Run code** のクリックでのみ実行します。現在の本文は「press Run code to execute your changes」と説明しており、UI と一致しています。

### 解消済み: author-side の残り項目をページに表示しない

監査時点の generator は **Keep learning** 節に `lesson.remaining` を表示していました。現在の generator と生成 HTML はこの節を出力しません。`remaining` 文字列は元 JSON に残っていますが、学習者向け画面には表示されません。

### Improvement: `blocks` の目標と課題の範囲が揃っていない

目標は、メソッドへのブロック引き渡しに加えて Proc/lambda の呼び出しまで掲げています。本文と例も `yield`、Proc、lambda、Ruby 3.4 の `it` を一つのレッスンに含めます。一方、課題と解答は `yield 2` を `yield 5` に変える操作だけを扱い、Proc/lambda の呼び出しや `it` の理解を確かめません。学習目標をブロックの引き渡しに絞るか、例とフィードバックを分けて Proc/lambda の動作も試せる構成にしてください。

### Improvement: Proc と lambda の差を本文が先取りしている

2 段落目は、lambda の引数検査と Proc/lambda の `return` の違いに触れますが、掲載コードはどちらも 1 引数で呼び、`return` も使いません。そのため本文の説明を例や課題で検証できません。この差を後の学習項目へ回すか、違いが出る短い実験と解説を加えてください。

## 実行確認

Playwright で開発プレビューを開き、教材の Run code ボタンから WASM 上の Ruby を実行しました。以下は表示された実際の `RUBY_VERSION` です。

| コース | 実ランタイム |
| --- | --- |
| Ruby 4.0 | 4.0.0 |
| Ruby 3.4 | 3.4.1 |
| Ruby 3.3 | 3.3.3 |
| Ruby 3.2 | 3.2.4 |
| Ruby 4.1 development | 4.1.0-dev |

`output` のスターターは Ruby 4.0 で `Hello, Ruby!\n5\nOne more line\nnil\n` を出力し、期待出力と一致しました。`p 2 + 3` を `p 2 * 3` に変えると、確認した全 5 ランタイムで数字が `6` になり、最後の `nil` は変わりませんでした。

`blocks` のスターター出力は Ruby 4.0、3.4、3.3、3.2 で期待値と一致しました。`yield 2` を `yield 5` に変えると、手動で確認した Ruby 4.0 と 4.1 development では先頭が `15` になり、後続の Proc/lambda 出力は `8`, `12` のままでした。Ruby 4.1 development では `it` を含む最終行も実行され、`[2, 4, 6]` となりました。`blocks` の課題出力は Ruby 3.2、3.3、3.4 で手動確認していません。スターター例の E2E 結果から課題出力までは推定しません。

修正後、`E2E_DEV_SERVER=1 PORT=18920 npx playwright test e2e/seo.spec.ts` は 82 件すべて成功しました。E2E は全 5 ランタイムの 15 レッスンのスターター例に加え、テーマ、Playground 引き継ぎ、進捗、モバイル表示、JavaScript 無効時の表示を確認しています。`npm run check` も成功し、lint、type check、82 unit tests、build が通りました。

## 公式資料との照合

- `output` の Ruby 4.0 [Code Layout](https://docs.ruby-lang.org/en/4.0/syntax/layout_rdoc.html) と [Code Comments](https://docs.ruby-lang.org/en/4.0/syntax/comments_rdoc.html) の参照先を確認しました。コメント、行区切り、インデントに関する説明を支えています。
- `blocks` の Ruby 4.0 [Calling Methods](https://docs.ruby-lang.org/en/4.0/syntax/calling_methods_rdoc.html) と [Proc](https://docs.ruby-lang.org/en/4.0/Proc.html) を確認しました。Ruby 3.2 と 3.3 の同名 [Calling Methods](https://docs.ruby-lang.org/en/3.2/syntax/calling_methods_rdoc.html) と [Proc](https://docs.ruby-lang.org/en/3.2/Proc.html) も存在し、ブロックと Proc の基本説明を支えています。
- `it` は Ruby 3.4 の [NEWS](https://docs.ruby-lang.org/en/3.4/NEWS_md.html) にブロック引数参照として追加された記載があります。Ruby 3.3 の [NEWS](https://docs.ruby-lang.org/en/3.3/NEWS_md.html) は、引数なし `it` 呼び出しの非推奨化と Ruby 3.4 でのブロック引数化を説明しています。したがって 3.2/3.3 の明示引数版と 3.4 以降の `it` 版という区別には根拠があります。
- 旧版の `Code Layout` リンク先は版ごとに確認が必要です。現行 generator は Ruby 3.2〜3.4 で `syntax/miscellaneous_rdoc.html` に振り替えます。Ruby 3.2 と 3.3 のページは存在し、式の終端とインデントを扱っています。Ruby 4.0 では `syntax/layout_rdoc.html` が存在します。

## 未確認

- `blocks` の `yield 5` 課題を Ruby 3.2、3.3、3.4 では手動実行していません。全バージョンのスターター出力が一致する E2E 結果とは区別しています。
- テーマ切替直後の編集中コード保持は個別に手動確認していません。E2E はテーマと編集コード引き継ぎを別々に確認しています。
