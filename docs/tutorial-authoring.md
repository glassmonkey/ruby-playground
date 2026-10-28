# Ruby チュートリアルの執筆・レビュー

チュートリアルの追加、版更新、内容評価には `$ruby-tutorial-authoring` を使ってください。このスキルは `skills/ruby-tutorial-authoring/` で管理し、教材データの扱い、版ごとの根拠確認、実ランタイムでの検証、執筆・レビュー基準を定めます。評価時の詳しい判定基準は同スキルの [評価ルーブリック](../skills/ruby-tutorial-authoring/references/evaluation.md) を参照してください。

教材データは `content/tutorial.json`、版カタログは `content/tutorial-versions.json` にあります。生成 HTML を直接編集せず、スキルの手順に従って確認してください。

作業は「構造化教材データの作成・評価」と「データからのページ生成・表示確認」に分けます。前者は `content/tutorial.json` を正本として学習目標・説明・コード・課題・版差分を確定し、後者は共通ジェネレーターでページを生成します。ページ生成時に本文を書き直したり、生成HTMLだけを修正したりしません。

- [教材データの契約](../skills/ruby-tutorial-authoring/references/data-contract.md)
- [ページ生成の手順](../skills/ruby-tutorial-authoring/references/page-generation.md)

依頼例: 「このリポジトリの ruby-tutorial-authoring スキルで、継承の教材データを作成して評価して」「教材データからページを生成し、プレビューで確認して」。新しいレッスンの公開まで依頼された場合は、両段階を続けて実施します。

スキル自体の動作確認は[新規作成・誤り検出の検証記録](tutorial-skill-validation.md)を参照してください。再実行用の教材JSONとブラウザスクリプトも保存しています。

章立ては `content/tutorial-chapters.json` の共通配列で管理し、全バージョンで章名・順序・レッスンIDを揃えます。公式Syntaxは内容の参考資料として用い、「4.0準拠」などの表記はしません。公式資料の旧版で章の場所が異なる場合も、教材の所属章は変えず参照URLを調整します。

Exampleは基礎となる代表例、Experimentは同じ概念を使った応用として作ります。本文の近くの選択肢からコードを選び、結果はRunで確認します。期待出力・解答は検証データとして保持し、ページには表示しません。進捗管理も設けません。学習順序は参考書の大まかな展開を参考にした独自構成とし、公式Ruby資料で内容を検証します。

学習順序は[執筆スキルの学習順序ガイド](../skills/ruby-tutorial-authoring/references/learning-sequence.md)で管理します。最初に値や式を実行し、改行やコメントはその中で説明します。参照マニュアルの項目や既存ページ数に合わせず、前提知識に応じて教材を分割・追加します。
