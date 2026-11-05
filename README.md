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
- Ruby code completion. The main editor provides Ruby LSP completions for Ruby
  3.3 and 4.0. Completion is enabled by default and can be turned off in the
  editor controls. Unsupported Ruby versions keep editing and execution
  available without downloading analysis assets. Shared URLs save the disabled
  state as `ac=0`.
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
start or reuse the gem proxy or workerd. The last full run on UI source head
`c60ee92b84bcdd979e68a9b6fa698469d19e8524` passed all 14 tests. Its command,
screenshots, traces and protocol captures are archived under
`test-results/archive/c60ee92b84bcdd979e68a9b6fa698469d19e8524/completion-e2e-full-run2/`.
A run on the final committed UI head is recorded in the corresponding
head-keyed archive before this PR is updated.

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

The completion E2E covers natural `upcase` and `greeting` insertion and Ruby
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

`npm run test:ci` passed 225 tests, and typecheck, lint, LSP asset verification
and production build passed on the current source. The full repository
proxy/general E2E suite and CI are separate and are not represented by the
completion-only suite. A public UI action that unmounts the editor was not
available for a direct browser unmount test; unit tests cover disposal,
cancellation, stale replies and timeout handling. CI is monitored by the
secretary.

Browser history navigation preserves the completion status when only the
source changes while the Ruby version and enabled setting stay the same.
Changing either setting recalculates status; code-only history moves keep the
existing ready or unavailable state and reuse the current analysis Worker.

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
