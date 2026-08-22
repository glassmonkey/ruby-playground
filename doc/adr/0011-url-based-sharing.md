# ADR-0011: 即席共有はURLエンコード方式、DBを介さない

## Status

Accepted (2026-08-22)

## Context

snippetを他人と共有する方式を検討した。user自身の既存実装 [glassmonkey/php-playground](https://github.com/glassmonkey/php-playground) を調査した結果、以下の実装事実を確認した:

- `app.tsx` で `lz-string` ライブラリ (`compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`) を使い、コード全文を圧縮してURLの `c` パラメータに埋め込んでいる
- バージョン (`v`) や出力形式 (`f`) も同様にクエリパラメータに乗せている
- URL更新は `history.pushState` で行い、ページ再読み込みを起こさない
- サーバー側コンポーネントは皆無。GitHub Pagesへの静的デプロイのみで、DBやAPIサーバーは持たない

## Decision

即席の共有 (「このコードとこの結果を今すぐ人に見せたい」) は、php-playgroundと同じくURLエンコード方式を採用する。`lz-string` 等でコードを圧縮し、URLのクエリパラメータに埋め込む。DBへの保存を経由しない。

これは [ADR-0012](0012-snippet-management-in-rails.md) で決める「保存・管理」とは別レイヤーの機能である。即席共有はDB不要でURLだけで完結し、管理はRailsのDBを介する。

## Consequences

- 即席共有にはRailsのDB・認証が一切関与しない。実装はフロントエンド (JS) だけで完結する
- URLが長くなる (コード量に比例する) 制約がある。過度に大きいsnippetの共有には向かない
- 「管理 (保存済みsnippet一覧)」と「即席共有 (URL)」が別の仕組みになるため、保存済みsnippetを共有する際のURL形態 (ADR-0012のURLとは別物か、統一するか) は実装時に整合させる
