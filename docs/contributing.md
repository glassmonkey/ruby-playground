# Contributing

This document covers local development, checks, deployment and the project
structure. For what the site does, see the [README](../README.md). Report bugs
and ideas in [GitHub issues](https://github.com/glassmonkey/ruby-playground/issues).

## Run locally

Use Node 24.19.0 (see `.node-version`) and npm 11.17.0. A local Ruby
installation is not required.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:18888>. The dev server listens only on loopback and
does not start if port 18888 is already in use. If your npm cache is not
writable, set `npm_config_cache` to a writable directory.

## Checks

```sh
npm run check        # ESLint, TypeScript, unit/component/real-WASM tests, build
npx playwright install chromium  # Linux may require --with-deps
npm run test:e2e     # production build + preview + Chromium tests
npm audit
```

- Real-WASM tests run the bundled Ruby runtimes and cover stdout, stderr,
  Unicode, exceptions, syntax errors, empty output, state reset and output
  limits.
- Unit and component tests cover worker settlement, cancel and timeout, URL
  validation and UI state.
- Browser tests cover Ruby execution and errors, loading and reloading shared
  URLs with auto-run and version preservation, literal HTML output, cancel and
  recovery, page metadata and tutorial pages. Screenshots are saved under
  `test-results/`.

If Chromium is installed but Playwright cannot download its browser:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

CI (`.github/workflows/ci.yml`) runs `npm run check` and the browser tests on
pushes and pull requests.

## Build and deploy

`npm run build` writes the site to `public/`, including the tutorial pages,
their social images and `sitemap.xml`. `npm run preview` serves it on port
8888. Neither command publishes anything.

Pushing to `main` deploys `public/` to GitHub Pages. See
[GitHub Pages deployment](pages-release.md) for the workflow, repository
settings, DNS and rollback.

## Project structure

- `src/runtime.ts` creates a Ruby VM and captures WASI writes and VM metadata.
- `src/workers/` manages the Worker lifecycle, timeout and cancellation. Each
  run starts a new Worker.
- `src/versions.ts` lists the selectable Ruby releases. The default is the
  newest stable entry.
- `src/share.ts` stores the code (`c`) and version (`v`) in the URL with
  lz-string and bounds decoding before expansion.
- `src/indexing.ts` adds `noindex` to URLs that carry share parameters.
- `src/editor.tsx` loads the locally bundled Monaco editor.
- `src/tutorial/` holds the tutorial data, routes, rendering and validation.
  `src/build/tutorial-plugin.ts` serves tutorial pages in development and
  renders them to static HTML at build time.
- `assets/` holds static files copied to the site root, such as fonts,
  `robots.txt`, the privacy policy and license notices.

## Ruby runtimes

The selectable runtimes are the official prebuilt ruby.wasm WASI packages for
each available stable minor version, plus one pinned development snapshot.
Adding or updating a runtime touches `package.json`, `src/versions.ts` and
`src/workers/ruby-worker.ts`. The real-WASM tests check the bundled
`RUBY_VERSION`, because the npm package version is not the Ruby patch version.

Versions older than 3.2 have no official WASI build. Ruby 3.1 and 2.7 predate
upstream WASI support and would need porting. A custom build must keep output
capture, VM metadata, a new VM per run and the disabled JavaScript bridge, and
pass the real-WASM and browser tests before it is offered.

## Tutorial content

Lessons are structured JSON in `src/tutorial/data/`. Edit them by following the
[ruby-tutorial-authoring skill](../.agents/skills/ruby-tutorial-authoring/SKILL.md),
run `npm run tutorial:validate`, then run `npm run build`. Generated HTML in
`public/` is not edited or tracked. See also
[Ruby tutorial authoring](tutorial-authoring.md).

## Search engines

`index.html` sets a canonical URL without a query and a `no-referrer` policy.
`robots.txt` allows all paths and points to the generated sitemap, which lists
the top page and the canonical tutorial pages. Share URLs get `noindex` on the
client side, so crawlers that do not run JavaScript do not see it.

## Dependencies and licenses

- `@codesandbox/sandpack-react` came with the php-playground baseline and is not
  used by the app.
- DOMPurify is overridden to 3.4.17 because Monaco pins an affected version.
  Revisit the override when Monaco updates its dependency.
- License notices for Ruby, ruby.wasm and the JavaScript packages in the
  production bundle are kept in `assets/licenses/` and published with the site.
