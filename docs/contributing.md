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
those read-only paths and adds CORS headers for the allowed origins. The paths,
origins and cache lifetimes are in `proxy/src/index.ts` and
`proxy/wrangler.jsonc`.

```sh
npm ci --prefix proxy   # install wrangler for the proxy, once
npm run proxy:dev       # run the Worker locally with wrangler
npm run proxy:e2e       # send real requests through a local proxy
```

`proxy:e2e` starts a local proxy if none is running. To check a deployed proxy
instead, set `GEM_PROXY_URL` to its URL and `GEM_PROXY_ORIGIN` to an origin it
allows. `npm run check` also runs the proxy's unit tests.

Deploying needs access to the Cloudflare account: run `npx wrangler login`,
then `npm run deploy` in `proxy/`. The Worker is served only on the custom
domain set in `proxy/wrangler.jsonc`.

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
