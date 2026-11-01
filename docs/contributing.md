# Contributing

This guide explains how to work on Ruby Playground. For what the site does, see
the [README](../README.md). Report bugs and ideas in
[GitHub issues](https://github.com/glassmonkey/ruby-playground/issues).

The code and configuration are the source of truth. This guide points to them
instead of repeating values such as versions, ports and limits.

## Set up

Use the Node version in `.node-version` and the npm version allowed by
`engines` in `package.json`. A local Ruby installation is not required.

```sh
npm ci
npm ci --prefix proxy   # required for browser tests and local gem requests
npm run dev
```

Vite prints the local URL. The dev server uses a fixed port and does not start
if that port is already in use.

## Checks

```sh
npm run check        # lint, type check, unit tests and build
npm run test:e2e     # browser tests against a production preview
```

Install the browser for `test:e2e` once with `npx playwright install chromium`.
The browser tests start the local gem proxy, so install its dependencies with
`npm ci --prefix proxy` first. Unit tests live in `__test__/` directories next to the code they test, and
browser tests live in `e2e/`. CI runs both on pushes and pull requests. See
`package.json` for the other scripts. The [gem test scenario inventory](gem-test-scenarios.md) separates mocked unit
checks, Ruby WASM component checks, local HTTP integration, browser E2E, and
public verification. `npm run test:e2e` starts the recorded-response server,
test-only Wrangler Worker, and app preview; Playwright owns and stops those
servers. Browser, Worker, and cassette-server requests use real local HTTP.
Normal tests replay recorded RubyGems responses and do not fall back to the
public service. Missing, corrupt, and delayed responses use local-only fault
controls around recorded data. Playwright does not reuse existing servers; a
busy port causes startup to fail without terminating another process.

`npm run proxy:e2e` is the local Worker API check. Its normal mode uses recorded
responses and has no external fallback. Public RubyGems access is limited to an explicit recording operation; recording
or refreshing cassettes requires separate authorization. The opt-in command is
`RUBYGEMS_CASSETTE_RECORD=1 npm --prefix proxy run record:fixtures`; it writes
response bodies and the manifest under `proxy/test-fixtures/cassettes/`. Do not
run it as part of normal tests, and do not use a public endpoint override as
part of the normal test suite. See the [cassette notes](../proxy/test-fixtures/README.md)
for captured-response metadata and local fault controls.

To run the gem browser scenarios against Vite's development server, use
`E2E_DEV_SERVER=1 npx playwright test e2e/gems.spec.ts`. By default,
`npm run test:e2e` tests the built app through Vite preview. The current recorded package identities and checksums are summarized in the
[scenario inventory](gem-test-scenarios.md); normal test commands replay the
checked-in responses. The explicit recording procedure is separate from
routine tests.

## Build and deploy

`npm run build` writes the static site to `public/`, and `npm run preview`
serves it. Neither command publishes anything. Pushing to `main` deploys the
site to GitHub Pages; see [GitHub Pages deployment](pages-release.md).

## Where things live

- `src/`: the Playground app. Ruby runs in a Web Worker started from
  `src/workers/`.
- `src/tutorial/`: tutorial lesson data, rendering and validation.
- `src/build/`: the Vite plugin that renders tutorial pages, social images and
  the sitemap.
- `e2e/`: browser tests.
- `proxy/`: the gem proxy, a Cloudflare Worker, and its end-to-end tests.
- `assets/`: static files copied to the site root.

## Gem proxy

rubygems.org serves gem metadata and `.gem` files without CORS headers, so
browser code cannot read them directly. The Worker in `proxy/` forwards only
those read-only paths and adds CORS headers for the allowed origins. It is
written with Hono, and its routes in `proxy/src/index.ts` are the contract with
the app: their types are exported as `AppType`, so code that calls them through
Hono's RPC client fails the type check when a path or parameter changes. Gem
names follow RubyGems' naming rule in `proxy/src/gem-name.ts`. The allowed
origins are in `proxy/wrangler.jsonc`.

```sh
npm ci --prefix proxy   # install wrangler for the proxy, once
npm run proxy:dev       # run the Worker locally with wrangler
npm run proxy:e2e       # check local Worker over HTTP with recorded responses
npm --prefix proxy run deploy -- --dry-run
```

The dry-run command bundles the Worker and checks its configuration without
uploading it. It does not verify Cloudflare credentials, account access, route
ownership, or live behavior.

There are three levels of proxy verification:

- Focused proxy unit tests stub `fetch`; they check route behavior without
  contacting RubyGems or Cloudflare. Cassette artifact checks inspect response
  bodies, hashes, licenses, and normalized error fixtures without HTTP; run
  them with `npm --prefix proxy run test:fixtures`. For focused unit tests, run:

  ```sh
  npm run test:ci -- proxy/src/index.test.ts proxy/src/gem-name.test.ts proxy/src/rpc.test.ts
  ```

- `npm run proxy:e2e` starts local `wrangler dev` and checks the Worker over
  HTTP against recorded RubyGems responses. It does not exercise the public
  Worker and does not contact RubyGems in normal replay mode.
- `npm run test:e2e` starts the local cassette server, test-only Wrangler
  Worker, and app preview, then tests the gem flow in Chromium. The browser,
  Worker, and cassette server communicate over real local HTTP.
- A run against `https://gems.ruby-play.dev` would verify the public Worker.
  The public endpoint remains unverified by the local checks above.

The proxy workflow runs the local Worker API checks for pull requests and main
changes, then has a separate deployment job for main after those checks pass.
The deploy job uses the GitHub Environment named `gem-proxy`. Its target and
credential configuration are managed outside this contributor procedure.
Local checks and Wrangler dry runs do not verify production credentials,
account access, route ownership, or live behavior. Production preparation
requires an approved exact target and credential scope, lifetime, and
placement. Do not put a recording credential or private issuer integration in
CI. Do not use manual `wrangler login` or direct deployment as part of these
local checks.

The app's gem requests use `http://127.0.0.1:8787` in development. Start
`npm run proxy:dev` alongside `npm run dev` to try bundle install locally. For
a production build served as a local preview, set the proxy URL at build time
so the preview talks to the local Worker:

```sh
VITE_GEM_PROXY_URL=http://127.0.0.1:8787 npm run build
npm run preview
```

Do not point a local preview at the production proxy: its CORS policy allows
the published site origin, not localhost. Gemfiles currently accept `gem
"name"` with version requirements and the default rubygems.org source; other
directives and sources are rejected. The app resolves dependencies in the
browser, installs packages into the WASI filesystem, and caches successfully
installed `.gem` files in browser Cache Storage. Gems that depend on threads,
sockets, or native C extensions are not supported by these runtimes. Opening a
shared URL may fetch and execute its gems, so treat shared Gemfiles and code as
untrusted input.

## Ruby runtimes

The Playground offers only official prebuilt ruby.wasm WASI packages, plus a
pinned development snapshot. To add or update a runtime, follow the
versioning skill listed in [Ruby tutorial skills](tutorial-authoring.md).

A Ruby version without an official WASI build would need a custom build. It
must keep output capture, VM metadata, a new VM per run and the disabled
JavaScript bridge, and pass the real-WASM and browser tests before it is
offered.

## Tutorial content

Lessons are JSON files in `src/tutorial/data/`. The authoring, curriculum,
versioning and review rules are repository skills listed in
[Ruby tutorial skills](tutorial-authoring.md). Generated HTML in `public/` is
not edited or tracked.

## Dependency notes

DOMPurify is overridden in `package.json` because Monaco pins an affected
version. Remove the override once Monaco depends on a fixed version.
