# ADR-0008: プロジェクトの方向転換 — agent hosting から Ruby realtime playground + snippet共有へ

## Status

Accepted (2026-08-22)

## Context

ADR-0001〜0007 は、Rails で個人用の chat 型 agent hosting サービスを作るという方向で、Turn/Step の3層モデル・Turbo Streams進捗反映・Agent定義スキーマ等を決定してきた。Credentialモデル (Anthropic API keyの暗号化保存) の実装まで着手していた。

その後、プロジェクトの方向を「Rubyのrealtime playground (ブラウザ内でコードをリアルタイム実行できるツール) として作り直し、実行したsnippetを共有・管理できるようにする」に転換する意向が示された。

## Decision

ADR-0001〜0007 は本ADRによって supersede する (内容自体は決定の記録として保持する)。ドメイン概念を「Agent / Conversation / Turn / Step」から「Snippet / Playground Session / Execution」に置き換え、Phase 0 (概念整理) からやり直す。

新方向の概念整理:

- **Snippet**: ユーザーが書いたRubyコード片。保存され、後で再実行・共有・閲覧できる
- **Playground Session**: コードを書いて即座に実行結果を見る、対話的な実行環境の1インスタンス
- **Execution**: 1回のコード実行。旧設計のTurnに相当するポジション

この新方向における個別の設計判断は ADR-0009 以降に記す。

## Consequences

- 旧ADRで決定した Turn/Step モデル、Turbo Streams進捗反映、Agent定義スキーマは新方向では使用しない
- 実装済みの Credential モデル (Anthropic API key用) は新方向では不要になる。コード自体の削除は別途実施のタイミングで行う (本ADRの時点ではまだドキュメント整理のみ)
- `doc/README.md` のプロジェクト概要・スコープ・ADR一覧を本ADR以降の内容に合わせて更新する
