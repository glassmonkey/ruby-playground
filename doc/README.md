# agsh — agent hosting サービス設計ドキュメント

## これは何か

個人用の chat 型 agent hosting サービスを Rails で作る。ユーザー (自分) が agent (LLM + system prompt) を定義し、スマホを含め場所を問わず chat 形式で会話できる。

## 概念の位置づけ

agent hosting サービスは「アプリケーション実行基盤」(一般PaaS/FaaSの兄弟) であり、同時に「AI agent 製品カテゴリ」(agent framework/agent builder/MCP server hosting の兄弟) でもある。一般PaaSやFaaSとの違いは、実行単位が「1 run (非決定的・外部API課金を伴う)」であること。agent framework/SDKとの違いは、実行環境ごと引き受けること。

## スコープ

- **個人用**: multi-tenant SaaS ではない ([ADR-0002](adr/0002-personal-use-scope.md))
- **設定駆動型**: 任意コード実行なし、model/system_prompt/tool構成のみを受け付ける ([ADR-0001](adr/0001-config-driven-execution.md))
- **MVP**: tool呼び出し無しの純粋なテキスト会話 (chatGPTライク) ([ADR-0007](adr/0007-mvp-scope-text-only-chat.md))

## 決定一覧 (ADR)

- [0001](adr/0001-config-driven-execution.md) 設定駆動型のagent実行 (任意コード実行なし) — Accepted
- [0002](adr/0002-personal-use-scope.md) 個人利用スコープ — Accepted
- [0003](adr/0003-async-execution.md) 非同期実行の採用 (Solid Queue) — Accepted
- [0004](adr/0004-conversation-turn-step-model.md) Conversation / Turn / Step データモデル — Accepted
- [0005](adr/0005-turbo-streams-for-progress.md) Turbo Streams による進捗反映 — Accepted
- [0006](adr/0006-agent-definition-schema.md) Agent定義スキーマ — Accepted
- [0007](adr/0007-mvp-scope-text-only-chat.md) MVPスコープ (tool呼び出し無しの純粋chat) — Accepted

## 今後の論点 (post-MVP、未決定)

- **論点D**: トークン節約のためのコンテキスト圧縮方式 (会話が伸びたときにどう圧縮してLLMに送るか)
- **論点E**: 最初にサポートするtool範囲 (web検索のみか、MCP server接続を最初から開けるか)
- **論点F**: モニタリングダッシュボードの構築方式 (自前 vs 外部監視ツール連携)

これらはMVP完成後、必要になった時点で `clarify-issue` の手順 (判断軸 → 選択肢評価 → 収束) で決定する。

## 用語

- **Conversation**: 会話全体の束
- **Turn**: 1往復の実行単位 (ユーザー入力 → agentの応答生成)。旧称 Run/Job を検討したが命名の衝突・しっくりこなさから Turn に確定 ([ADR-0004](adr/0004-conversation-turn-step-model.md))
- **Step**: Turn内の tool呼び出し1回分 (MVPでは未使用)
