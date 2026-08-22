# ADR-0001: 設定駆動型のagent実行 (任意コード実行なし)

## Status

Superseded by [ADR-0008](0008-pivot-to-ruby-playground.md) (2026-08-22)

## Context

agent hosting サービスとして、ユーザーが預けるのが「任意のコード (Docker image / SDKコード等)」か「設定 (prompt/model/tool構成)」かで、実行基盤の重さが大きく変わる。

- 任意コード持ち込み型は、sandbox隔離・network egress制御・build pipelineが必須になり、設計の主戦場がRailsの外 (コンテナ隔離基盤) に移る
- 設定駆動型は、実行体をこちらが実装する固定のagent runtimeに固定でき、任意コード実行のリスクが構造的に消える

「chat形式のエージェントをホスティングしたい」という要件が明らかになったことで、ユーザーが持ち込むのは実行可能なコードではなく、model・system_prompt・tool構成といった設定値であることが確定した。chat形式のagentは一般に、ユーザーが実行コードを書き込む形にはならない (Custom GPTやSlack botの一般形と同様)。

## Decision

Agentの実行はこちらが実装する固定のagent runtime (Rails アプリ内) が担う。ユーザーは設定 (model・system_prompt・tool構成) のみを渡し、任意コードは実行しない。sandbox隔離・build pipelineは持たない。

## Consequences

- sandbox/隔離基盤が不要になり、Railsだけで実行系が完結する
- ユーザーは用意されたtool/modelの範囲でしかagentを組めない。任意の独自ロジックを持ち込みたくなった場合は、別途ハイブリッド拡張 (任意コード実行の受け口を後から追加する) が必要になる
