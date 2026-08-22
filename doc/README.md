# ruby-playground 設計ドキュメント

## これは何か

Rubyのコード片 (snippet) をブラウザ上でリアルタイムに実行できるplaygroundを作り、実行したsnippetを共有・管理できるようにする。

このプロジェクトは元々「個人用 chat型 agent hosting サービス」として設計を始めたが、[ADR-0008](adr/0008-pivot-to-ruby-playground.md) で方向転換した。ADR-0001〜0007はその時代の決定であり、Superseded (廃止) となっている。

## 概念の位置づけ

- **Snippet**: ユーザーが書いたRubyコード片。保存され、後で再実行・共有・閲覧できる
- **Playground Session**: コードを書いて即座に実行結果を見る、対話的な実行環境の1インスタンス
- **Execution**: 1回のコード実行。結果がリアルタイムにストリーミングされる単位

対話的実行環境 (irb, Jupyter/notebook系) や、コード共有サービス (GitHub Gist, Pastebin) の兄弟にあたる。分岐点は「ブラウザ内でのリアルタイム実行 + 実行可能なコードの共有」を両立している点。

## スコープ

- **実行はクライアント側**: `ruby.wasm` でブラウザ内実行、サーバー側にサンドボックス基盤は持たない ([ADR-0009](adr/0009-client-side-wasm-execution.md))
- **毎回まっさらな状態で自動実行**: Web Worker + 実行毎の再生成、コード変更のデバウンス自動実行 ([ADR-0010](adr/0010-fresh-state-auto-execution.md))
- **即席共有はURLエンコード方式**: DBを介さない、`lz-string`でコードをURLに埋め込む ([ADR-0011](adr/0011-url-based-sharing.md))
- **管理はRails+DB、個人利用**: 保存済みSnippetの閲覧はログイン不要、作成・編集・削除は所有者のみ ([ADR-0012](adr/0012-snippet-management-in-rails.md))
- **MVPはエディタ+実行+URL即席共有のみ**: Snippet管理・認証はpost-MVP ([ADR-0013](adr/0013-mvp-scope.md))
- **wasmバンドルは別ビルド+Cloudflareホスティング**: Railsのimportmapには含めない、ローカルも同じ成果物をRailsが配信 ([ADR-0014](adr/0014-wasm-bundle-build-and-hosting.md))

## 決定一覧 (ADR)

- [0008](adr/0008-pivot-to-ruby-playground.md) プロジェクトの方向転換 (agent hosting → Ruby realtime playground) — Accepted
- [0009](adr/0009-client-side-wasm-execution.md) コード実行はクライアント側 (ruby.wasm) で行う — Accepted
- [0010](adr/0010-fresh-state-auto-execution.md) Web Worker内で毎回まっさらな状態から自動実行する — Accepted
- [0011](adr/0011-url-based-sharing.md) 即席共有はURLエンコード方式、DBを介さない — Accepted
- [0012](adr/0012-snippet-management-in-rails.md) Snippet管理はRailsで行う。閲覧はログイン不要、管理は所有者のみ — Accepted
- [0013](adr/0013-mvp-scope.md) MVPスコープ (エディタ+実行+URL即席共有のみ) — Accepted
- [0014](adr/0014-wasm-bundle-build-and-hosting.md) ruby.wasmバンドルは別途ビルドし、Cloudflareでホスティングする — Accepted

### 過去の決定 (Superseded, agent hosting時代)

- [0001](adr/0001-config-driven-execution.md)〜[0007](adr/0007-mvp-scope-text-only-chat.md) — [ADR-0008](adr/0008-pivot-to-ruby-playground.md)により廃止

## 今後の論点 (未決定)

- 即席共有 (ADR-0011のURL) と保存済みSnippet (ADR-0012のURL) のURL形態をどう整合させるか
- wasmバンドルのビルドに使うbundler (esbuild等) の選定
- Cloudflareの具体的な製品選定 (Pages / R2 等)

## 参考実装

- [glassmonkey/php-playground](https://github.com/glassmonkey/php-playground) ([php-play.dev](https://php-play.dev)) — 同じ作者による同種のPHP版。実行方式 (Web Worker + 毎回再生成 + 自動実行) と共有方式 (lz-string URL埋め込み) の実例として参照した
