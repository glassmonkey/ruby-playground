# Ruby completion runtime

The editor runs TypeProf 0.33.2 in a dedicated browser Worker. It does not use
the execution Worker and does not send editor contents to a service. The
analysis VM is Ruby 4.0.0 built with ruby.wasm 2.10.1. It loads the RBS core
for the selected analysis target and asks Prism 1.7.0 to parse as that Ruby
version.

## Supported Ruby targets

| Selected runtime   | Analysis syntax target | RBS core   | Behavior                                                        |
| ------------------ | ---------------------- | ---------- | --------------------------------------------------------------- |
| Ruby 3.3           | Prism 3.3              | RBS 3.4.0  | Completion enabled                                              |
| Ruby 4.0           | Prism 4.0              | RBS 3.10.0 | Completion enabled                                              |
| Ruby 3.2, 3.4, 4.1 | —                      | —          | Completion unavailable; no analysis Worker or assets are loaded |

The analysis VM is an implementation host, not the selected execution VM. RBS
is versioned so completion does not silently reuse another target's core
signatures. RBS does not contain every Ruby release's API change; the supported
matrix is deliberately limited to the tested 3.3 and 4.0 targets.

TypeProf 0.33.2 is pinned in [`Gemfile.lock`](../../../scripts/lsp/Gemfile.lock)
with gem SHA-256
`aa777c684d578ed27dc3e5d4bc4104c9eb5a76eedf7f5dd3366d571eaa6ca7c3` and MIT
license metadata. It requires Prism >= 1.4.0 and RBS >= 3.6.0; the runtime
bundle pins Prism 1.7.0 and uses the selected RBS core assets. The TypeProf LSP
adapter and version grammar bridge live in
[`analysis_server.rb`](../../../src/lsp/analysis_server.rb) and
[`versioned/adapter.rb`](../../../src/lsp/versioned/adapter.rb). These adapters
target TypeProf 0.33.2 internals and are checked by the fixed runtime version
matrix.

TypeProf's LSP completion returns method labels and signatures in the initial
response and does not advertise `completionItem/resolve`. The Monaco provider
uses those details directly. The adapter accepts one full-document change per
notification, matching the client sync contract. It temporarily removes a
method prefix from the current source to query after `.` and returns a textEdit
range against the untouched UTF-16 snapshot. It also provides lexical local
variable candidates from the active Prism scope; method/type candidates and
details still come from TypeProf. It does not call Ruby LSP as a fallback.

## Build and verify assets

The clean build uses Ruby 4.0.7 as the host, `ruby_wasm` 2.10.1, Ruby 4.0.0
source, WASI SDK 24.0 and Binaryen 108. `Gemfile.lock` pins TypeProf and build
dependencies. The build fetches the TypeProf gem and RBS 3.4.0/3.10.0 archives,
checks their hashes, and verifies canonical core hashes before writing public
assets.

```sh
npm ci
npm run lsp:build
npm run lsp:verify
npm run build
```

`lsp:build` recreates ignored `assets/lsp/` content from the pinned sources.
Vite copies this `publicDir` directory to the site's `/lsp/` output. The generated
`manifest.json` records TypeProf version, archive SHA/license/dependencies,
asset byte counts and SHA-256 values. The Worker downloads the `.gz` payloads,
decompresses them locally, verifies both representations against the manifest,
and only then compiles WASM or mounts core signatures. Hash query parameters
let immutable browser cache entries change when an artifact changes.

The selected cold transfer is the shared analysis WASM, the selected RBS core,
the two small Ruby adapters, and the manifest. Each build's generated
`assets/lsp/manifest.json` is authoritative for the bytes produced by that build.
`build-assets.rb` calculates hashes from generated files, and `lsp:verify`
checks those files against the manifest. This checks manifest-to-file
consistency; it does not guarantee bit-for-bit reproducible WASM output.

For the earlier Ruby LSP runtime, the local generated manifest recorded WASM
SHA-256 `913e37a91777a0e9e5ef6114eb0b3dc8e1d3ac990a15c144c6a0afc606daae5c`
and CI recorded `f478e08a804d9e4cfd0cb95753b5bc87887937291b8e553ab7a3269f5cc65f5e`.
The available comparison did not identify why those Ruby LSP build outputs
differed. This TypeProf switch rebuilds the runtime and has not claimed those
historical values as expected hashes.

This verification runs the generated WASM through the browser WASI shim and the
public LSP request path. It does not measure Monaco's integrated UI timings;
those need to be recorded against the combined UI/runtime head.

## Worker lifecycle

The editor creates one analysis Worker only for enabled 3.3/4.0 sessions. The
Worker initializes TypeProf once, then processes open/change/completion requests
in a single FIFO queue. Each completion uses the current Monaco document version
and UTF-16 position. Monaco drops a result after cancellation, model replacement,
a later edit, or provider disposal. Disabling completion, changing Ruby target,
or unmounting the editor disposes the provider and terminates its Worker.

Initialization has a 60 second deadline and each LSP request an 8 second
deadline. Fetch, integrity, WASM, protocol or timeout errors set completion to
unavailable and terminate that analysis Worker; editing and execution remain
independent. Turning completion back on creates a new Worker and indexes the
current editor document.

## Notices

The generated `/lsp/runtime-notice.txt` contains notices and license texts from
the packaged Ruby gems. The RBS license texts are emitted beside each versioned
core. Ruby and ruby.wasm notices remain at [`assets/`](../../../assets/).
