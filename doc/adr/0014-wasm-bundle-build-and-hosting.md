# ADR-0014: ruby.wasmバンドルは別途ビルドし、Cloudflareでホスティングする

## Status

Accepted (2026-08-22)

## Context

[ADR-0009](0009-client-side-wasm-execution.md) で決めた通り、コード実行はクライアント側 `ruby.wasm` で行う。必要なnpmパッケージ (`@ruby/4.0-wasm-wasi`, `@ruby/wasm-wasi`, `@bjorn3/browser_wasi_shim`) をRails標準のimportmap (`bin/importmap pin`) で取り込もうとしたが、これらのパッケージがJSPM (importmap-railsが依存する変換CDN) に未対応で失敗した。手動で `vendor/javascript/` にvendoringする方法も検討したが、`@ruby/wasm-wasi` が内部で複数ファイルにまたがる相対import (`vm.js`, `console.js`, `binding.js`, `bindgen/legacy/*.js` 等) を持っており、単純なvendoringでは対応しづらいことが判明した。

これを受けて、「Railsのimportmapに無理に押し込む」やり方から、「別途ちゃんとしたbundler (esbuild等) でビルドし、そのビルド成果物を配信する」方針に転換した。

さらに、このビルド成果物 (JSバンドル + `ruby+stdlib.wasm` 本体、合計30MB超) をRailsアプリ自体のasset pipelineに含めるのではなく、Cloudflare (Pages/R2等) で別途ホスティングする方向で検討している。これは以前確認した「CDNはセキュリティ的に怖い」という懸念とは矛盾しない。前回の懸念は「第三者のCDNが第三者のコードを実行時に配信するリスク」であり、今回は「自分がビルドした成果物を、自分の管理下のCloudflareでホスティングする」ため、実行時に未知のコードが紛れ込む余地がない。

ローカル開発時にどうするかも論点になった。候補:

- 案A: ローカルでも同じビルド成果物をRails自身が配信し (`public/` 等)、参照URLを環境ごとに出し分ける (dev: ローカルパス、prod: Cloudflare URL)
- 案B: ローカルでも常にCloudflareを見に行く (環境分岐は不要だが、変更のたびにデプロイ待ちが発生し、オフライン開発もできない)
- 案C: ローカル専用の軽い静的配信プロセスを別途立てる (docker-composeにサービス追加等)

## Decision

- ruby.wasm関連のJS依存 (`@ruby/wasm-wasi`, `@bjorn3/browser_wasi_shim` 等) と `ruby+stdlib.wasm` 本体は、Railsのimportmapとは別の、独立したbuildプロセス (bundler使用、ツール選定は実装時に決める) でバンドルする
- 本番では、このビルド成果物をCloudflare (具体的な製品はPages/R2等から実装時に選定) でホスティングする
- ローカル開発では**案A**を採用する。同じビルド成果物をRails自身が配信し (`public/` 等)、参照URLを環境ごとに出し分ける

## Consequences

- Rails本体のGemfile/importmapにruby.wasm関連の依存を持たない。ビルドプロセスとRailsアプリのデプロイが分離される
- 環境ごとのURL出し分けの仕組み (Rails設定 or 環境変数) を実装する必要がある
- Cloudflareの具体的な製品選定、bundlerの選定は未定 (実装時に決定する)
