# GitHub Pages deployment

The site is published at <https://ruby-play.dev/> with GitHub Pages, in the
same way as [php-playground](https://github.com/glassmonkey/php-playground)
(<https://php-play.dev/>).

## How a deployment runs

`.github/workflows/static.yml` runs on every push to `main`, and can also be
run manually from Actions. It installs dependencies with `npm ci`, runs
`npm run build`, uploads `public/` as the Pages artifact and deploys it. It
does not run tests; `ci.yml` runs the checks and E2E tests on pushes and pull
requests.

Only one deployment runs at a time, and a newer push cancels one in progress.
Each deployment replaces the whole site. Hashed assets from the previous build
are not kept, so a tab opened before a deployment can fail to load a lazily
loaded chunk, worker or WASM file until it is reloaded.

To roll back, revert the change on `main`. The push deploys the reverted build.

## Settings outside the repository

The workflow does not change these settings.

- Settings → Pages: the source is GitHub Actions, the custom domain is
  `ruby-play.dev`, and Enforce HTTPS is on. There is no `CNAME` file; GitHub
  ignores it for sites published by a custom Actions workflow.
- Settings → Environments → `github-pages`: deployments are limited to the
  `main` branch, with no required reviewer.
- DNS for `ruby-play.dev` is managed in Cloudflare with the proxy off (DNS
  only), because GitHub requests the TLS certificate from Let's Encrypt and
  needs the domain to point at GitHub Pages directly.
  - A: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
    `185.199.111.153`
  - AAAA: `2606:50c0:8000::153`, `2606:50c0:8001::153`,
    `2606:50c0:8002::153`, `2606:50c0:8003::153`
  - CNAME for `www`: `glassmonkey.github.io`. GitHub Pages redirects
    `www.ruby-play.dev` to `https://ruby-play.dev/`, and the certificate
    covers both names.

With the custom domain set, GitHub Pages redirects
`https://glassmonkey.github.io/ruby-playground/` to `https://ruby-play.dev/`
and keeps the query, so shared links made before the domain change still open.

## Checks after a deployment

Check that the Actions run succeeded, open <https://ruby-play.dev/>, confirm
that the sample Ruby code runs, and open a shared link. If the app does not
start, the worker or WASM fails, or shared code does not restore, revert the
change on `main`.
