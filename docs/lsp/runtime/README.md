# Ruby LSP runtime

The editor runs Shopify Ruby LSP 0.26.11 in a dedicated browser Worker. It
does not use the execution Worker and does not send editor contents to a
service. The analysis VM is Ruby 4.0.0 built with ruby.wasm 2.10.1. It loads
the RBS core for the selected analysis target and asks Prism 1.7.0 to parse as
that Ruby version.

## Supported Ruby targets

| Selected runtime | Analysis syntax target | RBS core | Behavior |
| --- | --- | --- | --- |
| Ruby 3.3 | Prism 3.3 | RBS 3.4.0 | Completion enabled |
| Ruby 4.0 | Prism 4.0 | RBS 3.10.0 | Completion enabled |
| Ruby 3.2, 3.4, 4.1 | — | — | Completion unavailable; no analysis Worker or assets are loaded |

The analysis VM is an implementation host, not the selected execution VM. RBS
is versioned so completion does not silently reuse another target's core
signatures. RBS does not contain every Ruby release's API change; for example,
the PoC found `Enumerator.produce(size:)` absent from the 4.0 RBS core. The
version matrix is deliberately limited to the tested 3.3 and 4.0 targets.

The adapter is pinned to Ruby LSP 0.26.11, upstream commit
`6745c162fce98b1738f8f602fbca38806c6863aa`, with RubyGems checksum pins in
[`Gemfile.lock`](../../../scripts/lsp/Gemfile.lock). Ruby LSP's internal APIs
are adapted in [`analysis_server.rb`](../../../src/lsp/analysis_server.rb)
and [`versioned/adapter.rb`](../../../src/lsp/versioned/adapter.rb). Changes to
that upstream version require rerunning the completion, signature, syntax and
version-difference checks.

## Build and verify assets

The clean build uses Ruby 4.0.7 as the host, `ruby_wasm` 2.10.1, Ruby 4.0.0
source, WASI SDK 24.0 and Binaryen 108. `Gemfile.lock` pins the Ruby LSP and
build dependencies. The build fetches RBS 3.4.0 and 3.10.0 from RubyGems and
checks their archive and canonical core hashes before writing any public
assets.

```sh
npm ci
npm run lsp:build
npm run build
```

`lsp:build` recreates ignored `assets/lsp/` content from the pinned sources.
Vite copies this `publicDir` directory to the site's `/lsp/` output. The generated
`manifest.json` records uncompressed and gzip byte counts and SHA-256 values.
The Worker downloads the `.gz` payloads, decompresses them locally, verifies
both representations against the manifest, and only then compiles WASM or
mounts core signatures. Hash query parameters let immutable browser cache
entries change when an artifact changes.

The selected transfer for a cold supported session is the shared analysis WASM,
the selected RBS core, the two small Ruby adapters, and the manifest. The
following table records a build observation from the original documentation
change (`f165fd5`); it is historical, not a current value or an enforced
expected digest:

| Artifact           | Source                        |     Uncompressed |    Gzip transfer | SHA-256                                                            |
| ------------------ | ----------------------------- | ---------------: | ---------------: | ------------------------------------------------------------------ |
| Analysis WASM      | Ruby 4.0.0 + ruby.wasm 2.10.1 | 67,732,288 bytes | 20,245,103 bytes | `68477a51fced2a098bfe1878106c129368c12171dd76c2e65cace28c06c47b9a` |
| Ruby 3.3 core JSON | RBS 3.4.0                     |  1,926,792 bytes |    402,103 bytes | `d6ecbf1415cf80978f6ed528c9dca8fec204d563604a6dbd9447c72e40818120` |
| Ruby 4.0 core JSON | RBS 3.10.0                    |  2,186,727 bytes |    450,443 bytes | `95a8daa87b42345515c21564b83df904ba6e0931bf1857210b8bdf34b6e8d396` |

The original record does not include a build log or complete per-build input
provenance for those values.

Each build's generated `assets/lsp/manifest.json` is authoritative for the
bytes produced by that build. `build-assets.rb` calculates its hashes from the
generated files, and `lsp:verify` checks those files against the manifest. This
checks manifest-to-file consistency; it does not compare the WASM with a fixed
historical SHA-256 or guarantee bit-for-bit reproducible output.

Later observations differ from the table. At the time of this investigation,
the existing local generated manifest recorded WASM SHA-256
`913e37a91777a0e9e5ef6114eb0b3dc8e1d3ac990a15c144c6a0afc606daae5c` (67,732,288
bytes). CI run `41993137240` reported
`f478e08a804d9e4cfd0cb95753b5bc87887937291b8e553ab7a3269f5cc65f5e` from the
Worker `ready` message. The Worker sends that manifest hash only after checking
the downloaded compressed and decompressed bytes against the same manifest.
The CI log does not retain the manifest or complete build provenance, so it
cannot establish why the observed hashes differ. The repository records Ruby,
ruby.wasm and package versions, but the available comparison does not identify
the exact output-affecting build inputs for both observations.

For the first cold supported session, the WASM plus selected core total 20.65 MB
compressed; adapters and manifest add about 7 KB. Repeated sessions rely on
browser HTTP cache. In the Node WASI probe on this development machine, VM
creation took 0.66–0.92 seconds; the first indexed completion took about 17 ms
and warm dispatches took 0.3–0.9 ms. These are Node measurements, not browser
startup or browser latency measurements. Integrated browser measurements and
UI verification results are recorded in the project [README: Ruby completion
verification](../../../README.md#ruby-completion-verification).

## Worker lifecycle

The editor creates one analysis Worker only for enabled 3.3/4.0 sessions. The
Worker initializes Ruby LSP once, then processes open/change/completion and
resolve requests in a single FIFO queue. Each completion uses the current
Monaco document version and UTF-16 position. Monaco drops a result after
cancellation, model replacement, a later edit, or provider disposal. Disabling
completion, changing Ruby target, or unmounting the editor disposes the
provider and terminates its Worker.

Initialization has a 60 second deadline and each LSP request an 8 second
deadline. Fetch, integrity, WASM, protocol or timeout errors set completion to
unavailable and terminate that analysis Worker; editing and execution remain
independent. Turning completion back on creates a new Worker and indexes the
current editor document.

## Notices

The generated `/lsp/runtime-notice.txt` contains notices from the packaged Ruby
gems. The RBS license texts are emitted beside each versioned core. Ruby and
ruby.wasm notices remain at [`assets/`](../../../assets/).
