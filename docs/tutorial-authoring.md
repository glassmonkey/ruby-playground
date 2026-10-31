# Ruby tutorial authoring

教材の作成・更新・評価には、[リポジトリ内の ruby-tutorial-authoring スキル](../.agents/skills/ruby-tutorial-authoring/SKILL.md)を使います。学習順序、データ契約、版別の公式参照、評価基準はスキルに集約しています。

`src/tutorial/data/` の教材 JSON を編集して `npm run tutorial:validate` で検証し、通常の `npm run build` で共通 React UI から静的ページとブラウザ用バンドルを生成します。生成 HTML は編集・追跡しません。内容の正確性、版ごとの実 WASM 実行、公式参照の意味的な対応、ブラウザ表示は、それぞれ別に確認してください。
