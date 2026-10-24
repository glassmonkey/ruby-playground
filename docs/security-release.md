# Security and privacy release notes

Ruby runs in a fresh Web Worker and VM per run. The Ruby JavaScript bridge is
disabled, the worker is terminated on stop or timeout, and existing limits
bound source length, output bytes, and run time. The HTML output remains in the
existing sandboxed iframe. These controls reduce exposure but do not establish
complete CPU or memory isolation or eliminate browser and host vulnerabilities.

No analytics or telemetry was added. The static app does not store Ruby output
on an application backend. A share URL contains the source code in its query
string; it may appear in browser history, clipboard contents, recipient systems,
browser synchronization, and hosting request handling. GitHub documents that
GitHub Pages logs and stores visitor IP addresses for security purposes. Query
retention details were not verified. The `no-referrer` policy limits normal
referrer transmission but does not remove the URL from those other systems.
Users should not put secrets or personal information in shared code.

The safety, privacy, and license pages are static files served with the site.
The license page links byte-for-byte copies of the root `LICENSE` and `NOTICE`,
the existing Ruby WASM license/notice, and a third-party notice inventory for
the JavaScript packages present in production bundle source maps. The inventory
records installed package versions, declared license metadata, lockfile tarball
sources/integrity, and includes each distinct license text copied verbatim from
the installed package. `@ruby/wasm-wasi` declares MIT but does not ship its own
license text in its npm archive; the notice inventory references the
byte-identical shared Ruby WASM license and notice copied from the sibling
`@ruby/4.0-wasm-wasi@2.10.1` distribution. The package manifest and lockfile
were not changed. `npm audit` is a read-only review; a dependency change or
material finding returns to the manager for a scope decision.

## Verification limits

Local browser verification can establish that these controls and messages are
present in the built app. It cannot prove complete sandbox isolation, host log
retention, actual search-engine behavior, or deployed CDN behavior. Those checks
remain separate from local results and require an approved public release.

References: [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection).
