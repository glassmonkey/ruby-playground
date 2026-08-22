# ADR-0006: Agent定義スキーマ

## Status

Accepted (2026-08-22)

## Context

Agent定義をどう表現するか (DBカラムで持つか、JSON/YAML 1個のカラムに寄せるか) を論点として検討していた。当初はtool構成の配列も含めた表現形式の判断が必要だと想定していたが、[ADR-0007](0007-mvp-scope-text-only-chat.md) でMVPスコープをtool呼び出し無しに絞ったことにより、Agentが持つ設定は `model` と `system_prompt` の2つのみとなった。

2カラム程度であれば表現形式に実質的なトレードオフが無く (後から変更するコストも小さい)、判断軸を立てて評価するまでもないと判断した。

## Decision

Agentは `model` (使用するLLMモデル) と `system_prompt` (指示文) をそれぞれ素直なカラムとして持つ。JSON化やDSL化は行わない。

## Consequences

- 将来tool構成等の複雑な設定を追加する際 (post-MVP、論点E) に、カラム追加かJSON化かを再検討する必要がある
