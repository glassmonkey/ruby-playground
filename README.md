# Ruby Playground

Ruby Playground is a free website for writing and running Ruby in your browser:
<https://ruby-play.dev/>. Type Ruby in the editor and the output updates as you
edit. You can switch between Ruby versions and share code by copying the URL.
No installation or account is required. Ruby runs inside the browser with
[ruby.wasm](https://github.com/ruby/ruby.wasm), so your code is not sent to a
server to be executed.

![Ruby Playground running the sample program, with the editor on the left and its output on the right](docs/images/playground.png)

The site also includes a step-by-step [Ruby tutorial](https://ruby-play.dev/tutorial/)
whose lessons run code in the page.

![A Ruby tutorial lesson with the explanation on the left and runnable code on the right](docs/images/tutorial.png)

## Features

- Live execution. Code runs shortly after you stop typing. Standard output,
  standard error and exceptions appear in the Output panel as plain text. Use
  `puts` or `p` to print values; expression return values are not shown
  automatically.
- Ruby code completion. The main editor uses TypeProf 0.33.2 for Ruby 3.3 and
  4.0. Completion is enabled by default and can be turned off in the editor
  controls. Unsupported Ruby versions keep editing and execution available
  without downloading analysis assets. Shared URLs save the disabled state as
  `ac=0`.
- Ruby versions. Choose from several Ruby versions, including a development
  snapshot. The selector shows the exact bundled patch version, and a panel
  shows the running VM's version, platform, encoding, release date and revision.
- Sharing by URL. The code and selected version are saved in the address bar as
  you edit. Copy the URL to share an example or bookmark it. Opening a shared
  link restores the code and runs it.
- Ruby tutorial. Lessons are grouped into chapters, from the basics to classes
  and more advanced syntax. Each lesson has an explanation, an example and
  experiments to run and edit. Each Ruby version has its own course at
  `/tutorial/{version}/`.
- Light and dark themes. The theme follows your system setting, and a theme you
  choose is remembered across reloads.

## Limitations

- Programs are single files. Standard input (`gets`), Rails, additional gems and
  saved snippets are not supported.
- Each run starts in a new Ruby VM, so variables, constants and files from
  earlier runs are not kept.
- Run time, output size, code length and share URL length are limited. The
  page shows a message when a limit is reached. Code that is too long for the
  URL still runs but is not saved in the URL.
- The first run downloads the selected runtime, which is tens of megabytes, and
  can be slow on a slow connection.
- The runtimes are official ruby.wasm builds. They can be older than the latest
  Ruby patch releases and can lack recent security fixes. The selector shows
  the exact patch version.
- Ruby completion uses the matching RBS core for Ruby 3.3 or 4.0. Completion is
  unavailable for Ruby 3.2, 3.4 and 4.1, and the signature data can omit APIs
  that are not present in its RBS release.

## Ruby completion verification

The completion-only Chromium suite runs against a production Vite build with
`PORT=6645 npx playwright test --config=e2e/completion.config.ts`. The isolated
config starts only Vite preview and matches `completion.spec.ts`; it does not
start or reuse the gem proxy or workerd. An earlier full run on UI source head
`c60ee92b84bcdd979e68a9b6fa698469d19e8524` passed all 14 tests. Its screenshots,
traces and protocol captures are archived under
`test-results/archive/c60ee92b84bcdd979e68a9b6fa698469d19e8524/completion-e2e-full-run2/`.
A later full run on local UI head `4d6f0a1f68d49159d32488723eb20400f8f7751f`
passed 13 tests and failed one midline `upcase` candidate wait. Its failure
trace and a readback correcting the invocation's mistyped head/hash metadata
are documented under
`test-results/archive/4d6f0a1f68d49159d32488723eb20400f8f7751f/completion-final-run1/`.
The run was executed from local head 4d6f; the published PR was still at c60.

That run used manifest SHA-256
`c93e49dc7769caf55ff2e14a70af56a042bfaa894b956b944db44d715edc3e13` and
analysis WASM SHA-256
`913e37a91777a0e9e5ef6114eb0b3dc8e1d3ac990a15c144c6a0afc606daae5c` (67,732,288
bytes). The WASM was copied from the runtime worktree to this worktree's
ignored build input; the asset manifest was generated from this branch's
adapter. The adapter did not change on runtime heads 0cabb, e598 or ecee, so
the WASM was not rebuilt. An earlier local measurement recorded 2,075 ms to
completion-ready, 1,267 ms Worker initialization, 1,312 ms to first candidate,
87 ms to a warm candidate, and 20,698,694 bytes across five LSP HTTP response
bodies. These are local measurements, not production-network timings.

On the later 4d6 product build, the archived browser metrics recorded 4,337 ms
from navigation to completion-ready, 3,077 ms Worker initialization, 2,391 ms
from natural `.upc` input to the first candidate, and 118 ms for a warm
candidate. The five HTTP LSP bodies totaled 20,698,694 bytes: 20,245,121 bytes
for the compressed analysis WASM, 450,443 bytes for the compressed Ruby 4.0
core, and 3,130 bytes for the manifest/adapter/source files. The run's head and
test-source hash fields were mistyped; actual values are read back in
`test-results/archive/4d6f0a1f68d49159d32488723eb20400f8f7751f/completion-final-run1/run-readback.json`.

The earlier completion E2E covers natural `upcase` and `greeting` insertion and Ruby
execution, `put`→`puts`, midline suffix preservation, Japanese and emoji UTF-16
positions, `Mine#rfind` shadowing/removal, version-specific API candidates,
the Fiber details matrix, completion OFF and URL/history restoration, initial
OFF without LSP asset fetch, unsupported versions 3.2/3.4/4.1, analysis failure,
Worker disposal/recreation, no-result behavior, and a forced completion
response delivered after OFF disposes its Worker. The late-response test is
E2E-only instrumentation; no production editor, client or Worker code is
changed by it.

The Fiber UI matrix on UI source head
`c60ee92b84bcdd979e68a9b6fa698469d19e8524` used an uncommitted probe diff SHA-256
`afbcbbf24e81069fb832517d3de0d18b0a6af4fdf7933b5f43003a2fc0f9c10c`. The
analysis-ready generations were `3.3` / worker 1, `4.0` / worker 2 and restored
`3.3` / worker 3. Each completion token 6 and resolve token 7 matched the same
worker, document version and candidate identity (`raise`, data and textEdit).
The rendered details showed `raise(msg = <default>)` without `cause` in 3.3
and `raise(msg = <default>, cause: <default>)` in 4.0. Raw responses, rendered
DOM, screenshots and trace are archived under
`test-results/archive/c60ee92b84bcdd979e68a9b6fa698469d19e8524/fiber-visible-signature-run2/`.

The test compares the first rendered line in `.suggest-details .docs` because
the LSP completion item has no `detail` field: Monaco's `.header .type` is
therefore empty, and list labels such as `raise, Method` do not carry the
version-specific signature. The displayed documentation is the public UI
result of resolving and rendering the candidate.

On local head `4d6f0a1f68d49159d32488723eb20400f8f7751f`,
`npm run test:ci` passed 225 tests before the runtime unmount component tests
were merged. After merging runtime test-only commit
`a3ffd23fb6bda3ad09f1beab69866cdccb310d3d`, `npm run test:ci` passed 227 tests
in 22 files; typecheck and lint also passed. The full repository
proxy/general E2E suite and CI are separate and are not represented by the
completion-only suite. No public UI action unmounts the editor, so that browser
path remains unverified. The runtime component-boundary tests in `src/editor.test.tsx`
unmount `RubyEditor` while completion or resolve is pending, then check Worker
termination, Monaco provider disposal and suppression of a delayed result. The
tests use React Testing Library and a fake Worker; they are component tests,
not a browser-page unmount test. The UI lane's one-case observer diagnostic
succeeded on the midline input: Worker 1 returned `+` and `+@` for document
version 32, then `upcase` and `upcase!` for version 35; the UI inserted
`upcase` and Ruby printed `HELLO!`. The preceding full-run failure remains
unexplained because that run has no corresponding Worker log. Its historical
failure and the later successful diagnostic remain separate records at
`test-results/archive/4d6f0a1f68d49159d32488723eb20400f8f7751f/`.

Browser history navigation preserves the completion status when only the
source changes while the Ruby version and enabled setting stay the same.
Changing either setting recalculates status; code-only history moves keep the
existing ready or unavailable state and reuse the current analysis Worker.

After merging runtime completion request fix `765943e3866c2136de8631660e6756db757cafd4`,
the full isolated Chromium completion suite passed 14/14 on UI merge head
`7659f5c883d99257ba27db790e822e30a01d0ccb`. The run includes the previously
failing midline case: natural `.upc` input in `puts "hello" + "!"` preserved
the trailing ` + "!`,
inserted `upcase`, and Ruby printed `HELLO!`. The full repository unit suite
passed 231 tests in 22 files on that head. Typecheck, lint, production build,
asset verification, and `git diff --check` also passed. This new successful
run does not establish the cause of the earlier 4d6 failure; its trace did not
contain the matching Worker request data.

The exact full-run command, source hashes, output screenshots, protocol files,
traces and result marker are archived at
`test-results/archive/7659f5c883d99257ba27db790e822e30a01d0ccb/completion-final-run1/`.
The full-run `.last-run.json` reports `passed` with no failed tests. The
midline-only run and the focused five-test priority run have separate archives
under the same head directory. All runs used manifest SHA-256
`c93e49dc7769caf55ff2e14a70af56a042bfaa894b956b944db44d715edc3e13` and
analysis WASM SHA-256
`913e37a91777a0e9e5ef6114eb0b3dc8e1d3ac990a15c144c6a0afc606daae5c`
(67,732,288 bytes). The WASM is the ignored build input copied from the
runtime worktree; assets were built from this branch's adapter. The runtime
change does not modify the Ruby adapter or asset source, so no WASM rebuild
was done. Focused measurements on the same product head are documented in
`completion-priority-run1/README.md`; they use local Vite preview and are not
production-network timings.

This UI result verifies component-level Worker/provider disposal through the
runtime's two `RubyEditor` unmount tests, including pending completion/resolve.
It does not verify unmount through a public browser-page control because the
product exposes no such control. PR acceptance, CI status and the separate
runtime investigation into stale-response behavior remain manager/secretary
work; this local run does not claim those decisions.

## TypeProf completion verification

The user requested a TypeProf rewrite. Runtime commit
`faf9cc800af8fdfbbc09bbe384c9c6fb0d84f258` was integrated into this UI lane.
The manager accepted the TypeProf 0.33.2 PoC's Ruby 3.3/4.0 versioned-core
feasibility after checking the version-matrix script and artifact hashes. That
PoC proves raw inference and adapter examples only; Monaco/provider behavior is
verified separately by the browser suite below. Historical Ruby LSP results
above are not TypeProf results.

The UI preserves the completion toggle, `ac=0` URL state, selected Ruby
version, and loading/ready/unsupported/error status through the existing
`RubyEditor` props. The UI lane adds an accessible live status and a short
natural-input instruction. A component test uses a mocked editor callback only
to verify status presentation; it does not simulate TypeProf candidates. The
dedicated `e2e/typeprof.spec.ts` covers inference, full-document updates,
prefix/suffix and UTF-16 insertion, Fiber detail UI, and stale responses. The
existing `e2e/completion.spec.ts` keeps the 14 public UI regression cases,
updated to TypeProf's initial completion detail and asset names.

After each UI source change, build the production preview and run the isolated
TypeProf suite first, then the existing regression suite:

```sh
npm run build
COMPLETION_TEST_MATCH=typeprof.spec.ts \
COMPLETION_ARTIFACT_KEY=archive/<exact-ui-head>/typeprof-run \
PORT=6645 npx playwright test --config=e2e/completion.config.ts
COMPLETION_TEST_MATCH=completion.spec.ts \
COMPLETION_ARTIFACT_KEY=archive/<exact-ui-head>/regression-run \
PORT=6645 npx playwright test --config=e2e/completion.config.ts
```

The current TypeProf asset manifest SHA-256 is
`c11e8e8a51a93fc47f0073cfd64926de0cd5d414c3359c03c5681601bae7b2d2`; its raw
analysis WASM is 68,605,538 bytes with SHA-256
`c090a01f1afdbaa83815e72e3c8bcf20640c6b9693543bbdf67a00ae59969c07`, and the
gzip asset is SHA-256
`dfc12260de297ba2a8e7cff513b8f1a12ef22603377da6d27a654b263b939a09`. The raw
WASM was copied from the runtime worktree after size/hash comparison; the
manifest and compressed assets were regenerated from this branch's adapter
using the lockfile-pinned Ruby 4.0.7/Bundler 4.0.20 environment. No WASM
rebuild was performed.

Do not share a TypeProf trial URL until the integrated production preview has
passed its browser checks. The formal TypeProf requirement draft remains
`/private/tmp/gla187-typeprof-requirements.md`; owner Issue/plan save is pending
recovery of operation `543d09b0...` by the manager. This lane does not retry or
route around that owner operation.

## Security and privacy

- Code runs in your browser in a Web Worker. Each run uses a new Worker and
  Ruby VM, and Ruby's JavaScript bridge is disabled. The Worker keeps the page
  responsive and separates runs, but it is not a security sandbox for hostile
  code. Run only code you trust.
- Shared links run automatically when opened, and the URL contains the full
  source code. Do not open links from sources you do not trust, and keep
  passwords and personal information out of your code. Because the code is part
  of the URL, it can remain in browser history and in hosting request logs.
- The site is a static site on GitHub Pages. There are no accounts and no
  application backend, and the site uses no analytics or advertising. See the
  [privacy policy](https://ruby-play.dev/privacy.html).

## Feedback and contributing

Report bugs and request features in
[GitHub issues](https://github.com/glassmonkey/ruby-playground/issues) or by DM
to [@glassmonekey](https://twitter.com/glassmonekey). For local setup, tests,
deployment and tutorial authoring, see [docs/contributing.md](docs/contributing.md).

You can support the project through
[GitHub Sponsors](https://github.com/sponsors/glassmonkey).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The build
configuration is adapted from
[php-playground](https://github.com/glassmonkey/php-playground). License
notices for Ruby and ruby.wasm are in [assets/licenses/](assets/licenses/).

The PR review found that an older Fiber E2E asserted a local fixed WASM hash,
which disagreed with clean CI-generated assets. The current check derives the
expected identity from the built `public/lsp/manifest.json`, computes the SHA-256
of the uncompressed generated preview WASM bytes, checks its byte count/hash
against that manifest, then compares each Worker `ready` hash with the same
manifest entry across 3.3→4.0→3.3. A separate fixture confirms that a different
valid hash is accepted and an inconsistent manifest hash fails. The modified
source and full 14/14 result are archived at
`test-results/archive/76db4282ee67a0d05f512b370610a72dee9210f7/dynamic-hash-full-run1/`.
