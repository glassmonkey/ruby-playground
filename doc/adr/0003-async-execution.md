# ADR-0003: 非同期実行の採用 (Solid Queue)

## Status

Superseded by [ADR-0008](0008-pivot-to-ruby-playground.md) (2026-08-22)

## Context

chatの1ターンをHTTPリクエスト内で同期的に処理し切るか (agentの応答生成が終わるまでブラウザを待たせる)、非同期でバックグラウンド処理し、進捗をリアルタイムに反映するか。

[ADR-0002](0002-personal-use-scope.md) の通りスマホ・場所を問わずアクセスするという要件があり、モバイル回線は不安定になりやすい。同期処理だと、待機中に通信が切れたり画面がロックされたりした場合、実行中のturnが失われるリスクがある。

判断軸: 同期 (実装がシンプル、Runの状態管理がほぼ不要) vs 非同期 (実行が長くなっても平気、途中経過を逐次表示できる、アプリを閉じても後で続きが見れる)。

## Decision

chatの1ターンはSolid Queueのbackground jobとして非同期実行し、状態 (pending/running/completed) をDBに永続化する。クライアントはアプリを閉じても、後で開き直せばDBの状態から続きを再現できる。

## Consequences

- turnの状態管理・進捗反映の仕組みが必要になる ([ADR-0004](0004-conversation-turn-step-model.md), [ADR-0005](0005-turbo-streams-for-progress.md) で詳細化)
- 同期処理よりも実装量は増えるが、モバイル利用時の堅牢性を確保できる
- [ADR-0007](0007-mvp-scope-text-only-chat.md) でtool呼び出しをMVPから外したことにより、「重いtool呼び出しで数十秒〜分かかる」という当初の根拠は弱まったが、モバイル回線の不安定さへの対処という理由は引き続き有効なため、方針は変更しない
