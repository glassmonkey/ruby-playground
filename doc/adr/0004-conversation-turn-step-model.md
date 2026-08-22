# ADR-0004: Conversation / Turn / Step のデータモデル

## Status

Accepted (2026-08-22)

## Context

chatの1往復をDB上でどこまで細かく分けて保存するかを検討した。候補は次の3つ:

- **3層**: Conversation → Turn (1往復の実行単位) → Step (tool呼び出し1回分)
- **2層+JSON**: Conversation → Message、tool呼び出しの詳細はMessageのjsonbカラムに埋め込む
- **2層のみ**: Conversation → Message、tool呼び出しの詳細は保持しない

判断軸として次の3本を設定した (単純性は「テーブル数の少なさ」として認識しつつ、優先度は低いものとして扱った):

- **可観測性**: tool呼び出し単位でSQL集計・追跡できるか
- **拡張性**: 実行中のtool呼び出しを独立したライフサイクル (実行中→完了、承認待ち等) として後から扱えるか
- **試験性**: tool呼び出し単位の状態遷移をテストで検証しやすいか

評価の結果、3層モデルのみが3軸すべてで◯評価となった。2層+JSON案は、複数jobが同じjsonbカラムを同時に書き換える競合リスクがあり拡張性で✗、2層のみ案はtool単位のデータが残らず可観測性で✗となった。特に「実行中のtool呼び出しを独立したライフサイクルとして扱えるか (拡張性)」は、[ADR-0003](0003-async-execution.md) で決めた「非同期実行中、アプリを閉じても後で続きが見れる」要件に直接効くため、knockout軸として機能した。

### エンティティ名の検討

「1ターン分の実行」を表すエンティティ名として、当初 **Run** を検討したが「しっくりこない」という声があった。代替として **Job** も検討したが、[ADR-0003](0003-async-execution.md) で非同期実行基盤に採用したSolid Queueが `solid_queue_jobs` テーブル・`SolidQueue::Job` という概念をすでに持っており、語彙が衝突する懸念があった (テーブル名自体はprefixで分かれ実害は小さいが、会話上「job」が2つの意味を持つことになる)。他に Task (Rakeタスク等と衝突)、Session (`request.session` と衝突)、Process (Ruby core の `Process` モジュールと衝突) も検討したが、いずれも既存語彙との衝突がある。

最終的に、判断軸 (意味の的確さ / 衝突の有無 / 会話との一貫性) で評価し、ここまでの設計会話で一貫して「ターン」と呼んでいた実体とそのまま対応し、Ruby/Rails/Solid Queueいずれとも衝突しない **Turn** を採用した。

## Decision

`Conversation has_many Turn`、`Turn has_many Step` という3層のデータモデルを採用する。

- **Turn**: 1往復の実行単位。`pending → running → completed` で状態遷移する。ユーザー入力と最終応答を紐付ける
- **Step**: Turn内のtool呼び出し1回分の記録。tool名・token数・実行結果を保持する。MVP ([ADR-0007](0007-mvp-scope-text-only-chat.md)) ではtool呼び出しが無いため未使用

非同期実行を担うActiveJobクラスは `TurnJob` と命名し、Solid Queueの語彙との衝突を避ける。

## Consequences

- テーブル数はやや増えるが、可観測性・拡張性・試験性を優先した
- MVPではStepテーブルは常に空のまま運用され、tool対応時 (post-MVP、論点E) にそのまま活用できる
- 進捗反映の実行フロー図は [ADR-0005](0005-turbo-streams-for-progress.md) を参照
