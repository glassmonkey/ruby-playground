# ADR-0017: レスポンシブ対応をスコープに含める

## Status

Accepted (2026-08-24)

## Context

#12 が「スマホ等でのレスポンシブ対応をスコープに含めるか検討する」というQuestion issueとして起票され、未決のまま残っていた。

経緯として、agent hosting時代の [ADR-0002](0002-personal-use-scope.md) に「スマホ利用など場所を問わず使いたい」という要件があった (同ADR Context)。ただしADR-0002 は [ADR-0008](0008-pivot-to-ruby-playground.md) で `Superseded` となっており、この要件はリモートagentをホスティングする文脈固有のものとして撤回されている。したがって ruby-playground の文脈でレスポンシブが必要かどうかは、改めて決める必要があった。

ところが判断を明示しないまま、#11 (全体レイアウトを整える / PR #21) の実装で実質的な対応が入った。現在のコードで確認できる事実:

- `app/assets/stylesheets/application.css` の `.playground__panes` は既定で `flex-direction: column` (縦積み)、`@media (min-width: 768px)` で `row` に切り替わる。つまりmobile-firstで実装されている
- `test/system/playground_test.rb` に2つのsystem testがあり、1200x900では `row`、480x900では `column` になることをそれぞれ検証している

つまり実装と検証は既に存在するが、それを「スコープに含む」と決めた記録がどこにもない状態だった。

## Decision

レスポンシブ対応をスコープに含める。#11 で入ったmobile-firstの実装と2サイズのsystem testを、そのまま既定路線として追認する。

以後、UIに触る変更はレスポンシブを織り込むことを前提とする。

## Consequences

- #12 はこのADRをもってクローズする
- #9 (エディタをMonaco/CodeMirrorに置き換える) を実装する際、狭い画面での挙動を実装スコープに含める必要がある。エディタライブラリの選定時にモバイルでの入力体験も評価軸に入る
- system testは480x900 / 1200x900の2サイズでの検証を維持する。ブレークポイント (現在768px) を変更する場合はテストも合わせて更新する
- この決定は [ADR-0016](0016-local-completion-scope.md) の完成ラインに追加の作業を発生させない。既に実装済みのものを追認するだけである
