# Ruby Playground

Environment-first restart of Ruby Playground using the same frontend foundation as
[php-playground](https://github.com/glassmonkey/php-playground): React 18,
TypeScript, Vite 7 and Chakra UI 2. The previous Rails application is removed from
this branch; its source remains available in Git history.

## Scope of this setup PR

- Reproducible Node/npm installation, lockfile, type checking, ESLint, Vitest and Playwright.
- A responsive, editable setup preview with an explicitly disabled Run button.
- Ruby 4.0 WASM dependencies pinned, alongside Monaco/Sandpack and lz-string for the next implementation.
- Static build output in `public/`, source assets in `assets/`, development port `18888`.
- Read-only CI verification. No automatic deployment, hosting, analytics, advertising or PHP-specific domain configuration.

**Ruby execution does not work in this PR.** This is the environment setup checkpoint,
not the finished playground. The editor is temporarily a textarea; Monaco/Sandpack
integration is deferred along with WASM execution and URL sharing.

## Requirements and startup

Use Node **24.19.0** (see `.node-version`) and npm 11. No Ruby, Rails, database,
Docker or application secrets are required.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:18888 **on the machine running Vite**. When this project runs
on an assistant's cloud machine, that URL belongs to the cloud machine, not your
PC. This repository does not provision a public preview URL. If your npm cache
location is not writable, set `npm_config_cache` to a writable directory before
running npm.

```sh
npm run check             # lint, types, component tests, production build
npx playwright install chromium  # once; Linux may need --with-deps
npm run test:e2e          # builds and tests the production preview
npm run build            # outputs public/
npm run preview          # serves public/ on port 8888
```

`npm run dev` binds loopback only and fails instead of silently changing ports.
For a deliberately exposed development environment, configure the environment's
own secure port forwarding rather than assuming localhost is publicly reachable.
Do not use the Vite development server as a production server.

## Next implementation checkpoint

1. Replace the temporary textarea with the PHP playground's editor approach.
2. Connect a Ruby WASM Worker, recreated per run; capture stdout/stderr and exceptions
   (not just eval's return value), including empty output and run-state reset.
3. Add execution timeout/cancellation and bounded output handling.
4. Add compressed URL sharing (`c`/`v`/`f`) with invalid/oversized-input tests.
5. Add console output and a sandboxed HTML preview without trusting generated HTML.
6. Test the runtime, repeated/interrupted runs and selected browser flows before any hosting decision.

The existing open PRs are not merged or closed by this setup. Merge this restart
only after deciding how those old-architecture changes should be handled.

## Attribution

The Vite directory/port conventions and dependency baseline are adapted from
`glassmonkey/php-playground` under Apache-2.0. Its license is retained in `LICENSE`;
see `NOTICE` for the reference revision. Runtime packages retain their respective
licenses. The previous Ruby repository did not contain a root license file.

If browser downloads are unavailable but Chromium is already installed, the smoke
test supports an explicit system-browser override:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

The default CI path continues to use Playwright's managed Chromium.

The PHP baseline's Vite/Vitest and TypeScript ESLint versions were updated for
reported security fixes. DOMPurify is overridden to 3.4.17 because Monaco's pinned
transitive version was affected by known advisories; revisit this override when
Monaco updates its own dependency. The Ruby runtime remains at 2.10.1.
