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
Unit tests live in `__test__/` directories next to the code they test, and
browser tests live in `e2e/`. CI runs both on pushes and pull requests. See
`package.json` for the other scripts.

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
npm run proxy:dev       # run the production-configured Worker locally
npm run proxy:e2e       # exercise the Worker against local recorded responses
```

`npm run test:e2e` starts the app preview, local cassette HTTP server and a
test-configured Wrangler Worker. `npm run proxy:e2e` starts the cassette server
and Worker for the proxy API tests. Both replay checked-in RubyGems responses;
they do not contact rubygems.org. The fixture Worker rewrites only the fixed
RubyGems origin to that local server and has no deploy routes. `npm run check`
runs the proxy unit tests. CI also validates cassette hashes.

Cassette contents, source URLs, licenses, recorded response metadata and
normalizations are documented in
[`proxy/test-fixtures/README.md`](../proxy/test-fixtures/README.md). Normal
tests never record or update fixtures. Recording is a separate, explicit
operation restricted by the recorder to its documented public URL allowlist:

```sh
RUBYGEMS_CASSETTE_RECORD=1 npm --prefix proxy run record:fixtures
```

Review the resulting bodies, hashes, metadata and license attribution before
proposing cassette changes. Do not put credentials or authenticated responses
in fixtures.

To check a deployed proxy instead, set `GEM_PROXY_URL` to its URL and
`GEM_PROXY_ORIGIN` to an origin it allows. Pull requests and feature branch
pushes run local cassette-backed tests and do not deploy. The proxy workflow
can deploy from `main` after its tests pass, including when manually dispatched
on `main`. Its `gem-proxy` GitHub environment supplies the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` values used by that job. A
deployment requires explicit authorization for the target, credentials, scope
and expiry. Do not use the fixture Wrangler config for a deployment.

`proxy:dev` uses the production Worker configuration for local development.
The custom domain in `proxy/wrangler.jsonc` is used by the deployment workflow.

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
