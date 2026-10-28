# 教材作成スキルの実地検証

2026-10-28。対象はリポジトリ内の `skills/ruby-tutorial-authoring/`。形式検査だけでなく、作成・生成・実行・独立レビューを試した。

## 新規作成からページ生成

既存の回答や正解を渡さず、別エージェントに「継承と super の初心者向けレッスンを適切な位置へ追加し、構造化データからページを生成する」と依頼した。隔離コピー `/tmp/ruby-tutorial-skill-trial` を使用し、通常の教材・プレビューには追加していない。

成果物は [inheritance.json](skill-validation/inheritance.json)。classes の次、modules の前に配置し、16レッスンのコースを生成できた。スキルの手順で型検査を実施し、親エージェントが production build も確認した。再生成前後の121ファイル（HTML、CSS、sitemap）のSHA-256が一致した。

作者とは別のエージェントが公式資料に照らしてレビューした。初稿では super の説明の適用範囲が広すぎ、親レビューでは `super(...)` という省略表現が実際のRuby構文と紛らわしいことも見つかった。JSON本文を修正して再生成し、独立レビューで残る重大な内容不備がないことを確認した。[再レビュー記録](skill-validation/content-review.md)を保存した。

この結果を受け、スキルに「簡略化した説明の適用範囲を限定する」「本文にも具体的な実行可能構文を用いる」を追加した。初稿を無修正で合格にした検証ではない。

## 実ブラウザでの確認

Playwrightから `http://127.0.0.1:18930/tutorial/{version}/inheritance/` を開き、Runボタンで例題と課題を実行した。例題は `Message: Check the door (urgent)`、課題は `ALERT: Message: Check the door (urgent)` と改行を出力した。

| コース | VMから取得した RUBY_VERSION | 例題・課題 | コード・版の引き継ぎ | テーマ変更時の編集保持 |
| --- | --- | --- | --- | --- |
| 4.0 | 4.0.0 | 成功 | 成功 | 成功 |
| 3.4 | 3.4.1 | 成功 | 成功 | 成功 |
| 3.3 | 3.3.3 | 成功 | 成功 | 成功 |
| 3.2 | 3.2.4 | 成功 | 成功 | 成功 |
| 4.1 development | 4.1.0 | 成功 | 成功 | 成功 |

developmentの識別はカタログ側のchannelであり、`RUBY_VERSION`文字列に `-dev` は含まれなかった。

現在位置、完了状態の再読み込み後の保持、390px幅のメニュー折りたたみ・横はみ出しなし、JavaScript無効時の本文を確認した。PCとモバイルのスクリーンショットを実際に確認した。結果は [browser-evidence.json](skill-validation/browser-evidence.json)、実行スクリプトは [verify-browser.mjs](skill-validation/verify-browser.mjs)。本文修正はコード・課題を変更せず、修正後にも全5版のブラウザ手順を再実行して成功した。生成HTMLは独立レビューでも確認した。

## 再実行

検証専用のコピーを作り、`content/tutorial.json` のclasses直後に保存したinheritance.jsonを挿入する。既存の同名レッスンがあれば重複追加しない。依存を導入した後、次をそのコピーで実行する。

```sh
npm run typecheck
npm run tutorial:generate
npm run build
npx vite --host 127.0.0.1 --port 18930 --strictPort
# 別ターミナルで、作業ディレクトリは検証コピーのルート
node docs/skill-validation/verify-browser.mjs
```

スクリプトの出力は検証コピー内の `browser-evidence.json`。本番教材の変更や公開は不要。

## 誤りを検出できるか

別の隔離コピー `/tmp/ruby-tutorial-skill-review-trial` に次の2つの不具合を入れ、場所や正解を知らせず別エージェントへoutputとblocksの評価を依頼した。通常の教材データには入れていない。

| 注入した不具合 | 期待する検出 | 確認結果 |
| --- | --- | --- |
| outputの期待出力だけ5から6へ変更 | 例題と出力の不一致 | レビューで検出。実行結果は5 |
| blocksの3.3用コードをitを使う新しい版のコードへ変更 | 旧版での実行失敗 | 実ブラウザでNameErrorを検出 |

後者は親エージェントもRuby 3.3のページからRunを押して独立に再現し、`undefined local variable or method 'it' for main (NameError)` を確認した。

初回レビューはローカルサーバー起動のEPERMで止まり、前者だけを指摘し、実行確認を未確認と報告した。利用可能な権限での再試行を促した後にブラウザ検証へ進んだ。このため「初回から支援なしで全工程を完了した」とは評価しない。また、共有コードの目視確認だけでは版別の不具合を見落としたため、スキルの評価手順に、各版の解決後データを個別に確認し、実行未確認の状態で互換性を合格にしないことを明記した。

## 判定と限界

構造化教材の新規作成、決定的なページ生成、5バージョンでの実行、独立レビューと修正、意図的な誤りの検出まで確認した。スキルの形式検査も成功した。これは代表的な1件の新規教材と2種類の不具合による検証であり、今後の全テーマや新しいRubyリリースの品質保証ではない。新規教材の自動採用・公開は行っていない。

不具合入りコピーの既存ブラウザ検証は76件成功・6件失敗となった。失敗の内訳はoutputの全5版とblocksの3.3で、注入した不具合と一致した。[独立レビューの記録](skill-validation/negative-review.md)を保存した。このコピーでの課題編集の追加プローブは画面要素の誤指定で完了せず、検証済みと数えていない。正常な新規inheritance教材の課題確認とは別の結果である。
