# ADR-0013: MVPスコープ — エディタ + ruby.wasm実行 + URL即席共有のみ

## Status

Accepted (2026-08-22)

## Context

[ADR-0009](0009-client-side-wasm-execution.md)〜[0012](0012-snippet-management-in-rails.md) で「実行」「共有」「管理」それぞれの方式は決まったが、最初のMVPにどこまで含めるかは未定だった。

「即席共有 (URL埋め込み)」と「保存済みSnippetの管理 (Rails+DB)」は、ADR-0011で明記した通りそもそも別レイヤーの機能であり、片方だけを先に作ることができる。

## Decision

MVPは次の範囲に絞る。

**含む**:
- コードエディタ (ブラウザ)
- `ruby.wasm` によるリアルタイム実行 (ADR-0009, 0010: Web Worker、毎回まっさらな状態、デバウンス自動実行)
- URLエンコードによる即席共有 (ADR-0011)

**含まない (post-MVP)**:
- Snippetの保存・一覧・編集・削除 (ADR-0012の管理機能)
- 認証

この範囲は、user自身の既存実装 [php-playground](https://github.com/glassmonkey/php-playground) とほぼ同等であり、実装量は小さい。Railsの役割はMVPの時点では薄く (playgroundページを配信するだけ)、「管理」機能を足すpost-MVPの段階からRailsの本領 (DB, 認証, CRUD) が活きてくる。

## Consequences

- MVPではRailsアプリはほぼ静的なフロントエンド配信に近い役割になる。DB・認証のコードはMVPでは書かない
- post-MVPでADR-0012 (Snippet管理) に着手する際、「即席共有からワンクリックで保存する」導線をどう作るかを検討する
