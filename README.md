# Ruby Playground

A browser-based Ruby learning playground built on the React 18, TypeScript,
Vite 7 and Chakra UI 2 foundation used by
[php-playground](https://github.com/glassmonkey/php-playground).
The former Rails app remains available in Git history.

## Run locally

Use Node **24.19.0** and npm 11. No Ruby, Rails, database or Docker is required.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:18888 on the **machine running Vite**. When running on an
assistant's cloud machine, this is not the user's PC localhost. No public hosting
or deployment is configured. The dev server binds loopback and uses a fixed port.
If your npm cache is not writable, set `npm_config_cache` to a writable directory.

## Features and limits

- Local-bundled Monaco editor with Ruby highlighting; no editor CDN required.
- Ruby 4.0 WASM with standard library, served as a local static asset (~32 MB).
  The first run must download/compile it and can take longer.
- Explicit Run, rerun and Stop. Every run creates and terminates a new Worker/VM;
  global variables, constants and virtual files are not retained.
- stdout, stderr and exceptions, including partial writes and empty output.
  Expression return values are not printed unless the Ruby code prints them.
- 20-second run/load timeout, 100 KB captured-output limit, 50,000-character code limit.
- Compressed `c` / `v` / `f` URL sharing using lz-string (`v=4.0`,
  `f=console|html`). Empty and Unicode source round-trip. Malformed or oversized
  links fall back with a warning; decoding is bounded before expansion.
- Shared links **never execute automatically**. Read code before pressing Run.
- Console output and a sandboxed HTML iframe. HTML scripts, forms, external
  resources and parent-page access are blocked; stderr stays outside the iframe.
- No standard-input interaction, Rails, external gems, multi-file projects or
  persistent snippets. Only Ruby 4.0 is offered in this iteration.

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
npm run test:e2e     # production build + Chromium tests
npm audit
```

Real-WASM tests cover stdout/stderr/Unicode, exceptions/syntax errors, empty
output, state reset and output caps. Unit/component tests cover worker settlement,
cancel/timeout, URL validation and UI state. Three browser flows cover real Ruby
execution/re-execution, URL sharing and sandboxed HTML, and cancel/recovery.

If browser downloads are unavailable but Chromium is installed:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

CI installs managed Chromium. The assistant cloud process sandbox prevents local
Chromium sockets; GitHub CI is the browser verification route in that environment.

`npm run build` outputs `public/`; `npm run preview` serves it on port 8888.
Source static assets live in `assets/`. Neither command publishes anything.

## Architecture / next decisions

`src/runtime.ts` creates a Ruby VM and captures WASI writes. `src/workers/` owns
the Worker lifecycle. `src/share.ts` bounds compressed URL decoding. `src/editor.tsx`
loads Monaco locally; Sandpack remains an installed baseline dependency but does
not execute/bundle user code. React holds the single-file editor state directly.

Future hosting, Ruby version matrix, gem support and additional editing features
are deliberately separate decisions. Existing old-architecture PRs are untouched.

## Attribution and dependencies

The Vite directory/port conventions and dependency baseline derive from
`glassmonkey/php-playground` (Apache-2.0); see `LICENSE` and `NOTICE`.
Ruby WASM redistribution notices are copied to `assets/licenses/` and included in
the static build. Other packages retain their own licenses.

Vite/Vitest and TypeScript ESLint use security-patched versions rather than the
older PHP pins. DOMPurify is overridden to 3.4.17 while Monaco pins an affected
version; revisit that override when Monaco updates its dependency.
