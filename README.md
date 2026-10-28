# Ruby Playground

A browser-based Ruby learning playground built on the React 18, TypeScript,
Vite 7 and Chakra UI 2 foundation used by
[php-playground](https://github.com/glassmonkey/php-playground).
It is published at <https://ruby-play.dev/>.
The former Rails app remains available in Git history.

## Run locally

Use Node **24.19.0** and npm **11.17.0**. No Ruby, Rails, database or Docker
is required.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:18888 on the **machine running Vite**. When running on an
assistant's cloud machine, this is not the user's PC localhost. The dev server
binds loopback and uses a fixed port.
If your npm cache is not writable, set `npm_config_cache` to a writable directory.

## Features and limits

- Ruby-red accents, warm neutral surfaces and locally hosted Plus Jakarta Sans.

- Full-width workspace: side-by-side editor/output on large
  screens and stacked panes on smaller screens, with an 80vh working area.
- System-aware light/dark UI and Monaco themes, remembered across reloads.
  Code and version are saved automatically to the address bar
  using compressed, URL-safe parameters. Copy the address to share or reload to
  restore. Updates replace the current history entry. Oversized URLs show a warning
  and remove stale code parameters; the editor keeps the source.

- Local-bundled Monaco editor with Ruby highlighting; no editor CDN required.
- Select Ruby 4.0, 3.4, 3.3, 3.2 or 4.1 (development snapshot). Pinned official ruby.wasm 2.10.1 builds contain
  **Ruby 4.0.0 / 3.4.1 / 3.3.3 / 3.2.4**, verified by real `RUBY_VERSION` tests, not
  the latest Ruby security patch releases. Each selected standard-library WASM
  is served locally (~32 MB); only the selected runtime is downloaded.
  Ruby 4.1 is pinned separately to `@ruby/head-wasm-wasi@2.10.1-2026-10-28-a`: Ruby
  **4.1.0dev**, dated 2026-10-28, revision
  `79de9be7d8bfdf8d573ceda4fdc98a478fabf9e4`. It is an experimental snapshot,
  not an automatically updated nightly. The selector identifies it as 4.1 with a development label.
  See the security/release limitation below.
- Live execution after 350 ms without edits, including initial/shared links and
  version changes. There is no Run button; Stop stays available while running.
  Edits/switches terminate old work immediately and ignore stale results.
  Stop/timeout do not loop or retry; edit code or change version to resume. Every run creates and terminates a new Worker/VM;
  global variables, constants and virtual files are not retained.
- stdout, stderr and exceptions, including partial writes and empty output.
  Expression return values are not printed unless the Ruby code prints them.
- 20-second run/load timeout, 100 KB captured-output limit, 50,000-character code limit.
- Compressed `c` / `v` URL state using lz-string (`v=4.0|3.4|3.3|3.2|4.1`). Empty and
  Unicode source round-trip. Malformed or oversized links fall back with a warning;
  decoding is bounded before expansion. Legacy `f` parameters are ignored and removed
  on the next edit.
- Shared links **execute automatically**. Do not open untrusted shared links.
- The initial sample recursively draws a fractal from `%w[Hello Ruby!]`.
  Change the words or recursion depth to change the pattern. The default depth is 3.
- Console output always displays stdout/stderr literally, including the sample.
  Long lines scroll horizontally to preserve ASCII art and whitespace.
  A separate environment panel shows the
  actual VM's version, platform, encoding, release date and revision. The Worker
  reports these before user code runs, so information remains available during
  long runs and after code errors. Switching Ruby versions replaces the metadata;
  cancelled runs cannot update it. Printed HTML and scripts remain plain text.
- No standard-input interaction, Rails, external gems, multi-file projects or
  persistent snippets. Ruby versions older than 3.2 are not offered.

A Worker is a responsiveness/isolation boundary, **not a security sandbox for
hostile Ruby**. Ruby's JS bridge is disabled at the WASM import boundary, so Worker globals,
network and storage APIs are not intentionally exposed to Ruby.
Do not run untrusted code or input secrets. Shared URLs contain the complete
source; anyone receiving the URL can read it. URLs may also appear in browser
history or server access logs. There is no account/authenticated data in this app.
The output cap limits captured output, not arbitrary Ruby memory allocations.

## Verification

```sh
npm run check        # ESLint, TypeScript, unit/component/real-WASM tests, build
npx playwright install chromium  # Linux may require --with-deps
npm run test:e2e     # production preview + Chromium tests
npm audit
```

Real-WASM tests cover stdout/stderr/Unicode, exceptions/syntax errors, empty
output, state reset and output caps. Unit/component tests cover worker settlement,
cancel/timeout, URL validation and UI state. CI runs browser flows:
real Ruby execution/errors, shared URL direct
load/reload with auto-run and version preservation, literal HTML output, and cancel/recovery. The Ruby
output flow saves a screenshot under `test-results/`.

If browser downloads are unavailable but Chromium is installed:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

CI installs managed Chromium. The assistant cloud process sandbox prevents local
Chromium sockets; GitHub CI is the browser verification route in that environment.

`npm run build` outputs `public/`; `npm run preview` serves it on port 8888.
Source static assets live in `assets/`. Build and preview do not publish
anything. Pushes to `main` publish the site to GitHub Pages; see
[the Pages deployment notes](docs/pages-release.md).

## Architecture / next decisions

`src/runtime.ts` creates a Ruby VM and captures WASI writes. `src/workers/` owns
the Worker lifecycle. `src/share.ts` bounds compressed URL decoding. `src/editor.tsx`
loads Monaco locally; Sandpack remains an installed baseline dependency but does
not execute/bundle user code. React holds the single-file editor state directly.

The current version policy is to use official prebuilt WASI runtimes for all
available stable Ruby minor lines plus a pinned 4.1 development snapshot. Historical snapshots
and Emscripten variants of the same Ruby are not separate version options.
Future work should build older CRuby versions to WASM, starting with a feasibility
check for 3.1 and 2.7: they predate upstream WASI support and require porting work.
Custom builds must preserve output capture, VM metadata, fresh-VM isolation and
the blocked JS bridge, and pass real-WASM and browser tests before being offered.

Patched WASM builds, gem support and additional editing features are
deliberately separate decisions. Existing old-architecture PRs are untouched.

## Attribution and dependencies

The Vite directory/port conventions and dependency baseline derive from
`glassmonkey/php-playground` (Apache-2.0); see `LICENSE` and `NOTICE`.
Ruby WASM redistribution notices are copied to `assets/licenses/` and included in
the static build. Other packages retain their own licenses.

Vite/Vitest and TypeScript ESLint use security-patched versions rather than the
older PHP pins. DOMPurify is overridden to 3.4.17 while Monaco pins an affected
version; revisit that override when Monaco updates its dependency.

## Runtime patch-level limitations

As checked on 2026-10-25, npm's latest official `@ruby/{4.0,3.4,3.3}-wasm-wasi`
packages are 2.10.1. The [official dated WASM release](https://github.com/ruby/ruby.wasm/releases/tag/2026-10-25-a)
also lists Ruby 4.0.0, 3.4.1 and 3.3.3 source tarballs. These lag the
[2026-10-23 security fixes](https://www.ruby-lang.org/en/news/2026/10/23/regexp-fixes-for-gitlab-cves/)
in 4.0.9 / 3.4.12 / 3.3.13. The npm wrapper version is not a Ruby patch version.
The additional pinned `@ruby/3.2-wasm-wasi` 2.10.1 build contains Ruby 3.2.4
(2024-04-23), also verified by real VM tests.
The selector and badge disclose exact bundled patches. The JS bridge remains
blocked for every minor, but that is not a substitute for patched Ruby.

The owner accepted browser-only execution with these disclosed patch levels.
The blocked JS host bridge and fresh Worker/VM reduce exposure, but a Worker is
not a guaranteed separate OS process or a hard memory budget. Ruby VM corruption,
crashes and browser resource exhaustion remain possible. Native GitLab server
RCE is not evidence of browser/host RCE in this configuration. Run timeout and
source limits do not fix regexp compilation bugs. Shared links automatically
execute; do not open untrusted links or enter secrets. Patched trusted builds
remain recommended follow-up work, not a claim that current builds are patched.

## Ruby tutorial

The Ruby tutorial presents a guided lesson sequence with a chapter sidebar and
visible course progress. Each lesson combines a short explanation, an editable
Ruby example, an explicit Run control, expected output, a practice task and
feedback. Lesson text and starter code remain readable without JavaScript.

The header version selector switches the course, starter code and bundled runtime
together. It shows concrete Ruby version numbers; the Ruby 4.1 development
course is labeled separately. `/tutorial/` resolves to the internal default
stable course, while `/tutorial/{version}/{slug}/` preserves version-specific
lesson URLs. The Light/Dark control shares its saved preference with the main
Playground and keeps it across lesson and version navigation.

Continue in the full Playground to carry the current edits and selected Ruby
version into a new tab. For lesson authoring, release updates and content
evaluation, see the [Ruby tutorial authoring skill](skills/ruby-tutorial-authoring/SKILL.md)
and its [evaluation record](docs/tutorial-skill-evaluation.md).
