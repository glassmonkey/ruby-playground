# GitHub Pages release runbook

The release workflow is a manual `workflow_dispatch` on `main`. It builds an
artifact by default and never deploys unless the `publish` input is checked.
The `release_stage` input selects `preview` or `production`; the optional
`source_sha` selects a full commit SHA reachable from `main`. Packaging runs
from the workflow revision on `main`, while the app is built from the selected
source SHA. The packaging logic stays in the workflow so an older rollback SHA
does not need to contain newer helper files.

The standard URL is <https://glassmonkey.github.io/ruby-playground/>. Preview
is served at <https://glassmonkey.github.io/ruby-playground/staging/>. Preview
artifacts put the app under `staging/`, add a persistent `noindex,nofollow`
robots meta tag to its initial HTML, and put a noindex “preview is being
prepared” page at the site root. The production artifact puts the app at the
site root and does not add the preview robots tag. Both app entry points expose
the selected source SHA and stage as HTML metadata. `release-info.json` records
the source SHA, base path, stage, and each WASM file's published path, byte
length, and SHA-256. The persistent preview tag uses
`data-pages-preview-noindex`, separate from the app's `data-share-noindex`
marker so shared-page behavior cannot remove the preview exclusion.

The workflow deploys a Pages artifact for the whole site. The preview artifact
therefore replaces the root production app with the prepared noindex entry. Use
the preview sequence below only before the first production deployment. After
production has been published once, do not dispatch or approve this same-site
preview workflow until a separate preview site or a design that preserves the
production root has been reviewed and authorized. This stop condition is
independent of the stale-HTML/hashed-asset gate for production updates.

## Build and inspect an artifact

1. Use **Actions → Pages release → Run workflow** on the `main` branch.
2. Choose `preview` first. Leave `source_sha` empty to use the workflow's
   current `main` commit, or provide a full SHA reachable from `main` for a
   baseline or rollback rebuild.
3. Leave **Deploy the built artifact** unchecked. The workflow validates the
   stage and SHA, runs `npm run check`, runs the existing E2E suite at both `/`
   and the selected Pages base path, builds the app and uploads `public/` for
   seven days.
4. Save the Actions run URL and artifact locator with its source SHA. Inspect
   `release-info.json`; confirm its `source_sha`, `base_path`, and `stage` match
   the intended build. For preview, confirm the app is under `staging/`, the
   root is only the prepared noindex entry, and `staging/index.html` contains
   the preview noindex marker and matching `release-source` metadata.

An expired artifact can be rebuilt from the same SHA, but that is a new build:
inspect the new artifact and obtain a fresh environment approval before
deploying it. The workflow artifact is temporary evidence, not a durable
release archive.

## Release and rollback sequence

The manager coordinates Pages settings, approvals, dispatches, and promotion.
Before the first deployment, configure Pages to use **GitHub Actions** and
restrict the `github-pages` environment to `main` with the required reviewer.
This repository workflow does not change settings or start a deployment.

For the initial rollout before first production, keep the baseline and
candidate source SHAs and run URLs:

1. Build and deploy the accepted baseline SHA as `preview`; run the deployed
   smoke checks below against its exact URL and SHA.
2. Build and deploy the release candidate as `preview`; repeat the smoke
   checks.
3. Deploy the baseline SHA to `preview` again and verify the preview's
   `release-info.json` returns to that SHA. This is a preview rollback only.
4. Build the same candidate SHA as `production`, inspect its artifact, then
   obtain the production environment approval and deploy it. Verify the
   standard URL and source SHA.

After step 4 succeeds, stop using the same-site preview steps above. Later
production updates use the production path and the stale-HTML/hashed-asset gate
below; preview dispatch/approval remains stopped until its serving design has
been reviewed and authorized.

The first production deployment has no previous production SHA to roll back
to. Record that state explicitly. For later rollbacks, rebuild the last
known-good production SHA as `production`, inspect the new artifact, and obtain
a new environment approval. Do not treat a previous preview deployment as the
production rollback target.

Each deployment replaces the Pages artifact as a whole. The workflow does not
retain old hashed JS, worker, or WASM assets in the new artifact. A browser
holding stale HTML can therefore request an asset no longer present. GitHub
Pages headers are not configured by this workflow, so it cannot guarantee a
short HTML cache lifetime or per-file cache policy. Observe cache headers and
stale-HTML behavior during host checks; do not claim old-asset retention.

Before every production update after the first, compare the currently deployed
HTML asset references with the candidate artifact and check the stale-HTML
window. If cached HTML can reference a missing hash and no mitigation is ready,
stop the deployment until asset availability or a reviewed cache plan resolves
it. The first production deployment has no previous production HTML or SHA,
which is different from a later update that can strand old asset references.

## Manual post-deployment checks

The service owner is `glassmonkey`. Immediately after the first production
deployment, the manager and publication operator run the live smoke once. On
the next business day, hand off one more manual check to a person; do not
schedule it automatically. Repeat the same check after later updates or when a
bug is reported: standard URL and app startup, deployed `release-info.json`
source SHA, worker/WASM load and Ruby run, shared-code restore, and observed
HTTP 4xx/5xx responses. Review the Actions run and any available billing or
usage warnings. Continuous access logs or traffic summaries are not assumed to
be available from Pages; data that cannot be fetched remains unknown.

Stop retries and further production dispatches if the app cannot start, the
worker/WASM fails, the deployed SHA differs from the approved SHA, shared code
is corrupted or exposed, or actual billing/usage warnings appear. Record the
evidence against GLA-88/GLA-93 and return the decision to the service owner.
Keep the known 20-second low-speed cold-start timeout distinct from startup,
worker/WASM, permission, CI, and host failures. The first production release
has no previous production SHA; for later releases, use only the recorded
last-good production SHA for an approval-gated rollback.

The next-business-day handoff has not been performed and is not automatically
scheduled by this runbook.

## Deployed host checks

Run the new host config only after the manager provides the exact deployment
URL, expected source SHA, and stage. It starts no local server and rejects
missing or invalid values. For example:

```sh
PLAYWRIGHT_BASE_URL=https://glassmonkey.github.io/ruby-playground/staging/ \
EXPECTED_SOURCE_SHA=<40-character-source-sha> \
DEPLOYMENT_STAGE=preview \
npx playwright test --config=playwright.deployed.config.ts
```

For production, use the standard URL and `DEPLOYMENT_STAGE=production`. The
suite checks the selected host's release metadata, initial HTML robots state,
canonical URL, unknown-path 404, and existing app flows (Ruby output/errors,
stop/recovery, share URL direct-load/reload, HTML sandboxing, and safety/license
links). The stage selects only the setup/security/deployed specs for preview,
and setup/security/SEO/deployed specs for production; local slow-measurement UX
specs do not run here. The deployed checks use one worker, explicitly run Ruby
once to exercise worker/WASM requests, and wait for those responses before
recording evidence. They record the response body buffer length separately
from encoded response and header sizes reported by Playwright's browser
request measurements; the body buffer may be decoded and is not treated as
wire transfer size. API fetches have no Playwright request-size measurement
and keep those fields unknown. Header values depend on GitHub Pages and
intermediaries; this measurement does not imply that the workflow controls
them.

The deployed spec skips when `PLAYWRIGHT_BASE_URL` is absent during ordinary
local E2E runs, so local CI never probes an unpublished host. The dedicated
deployed config instead requires all three variables and enforces HTTPS. Save
the test report, deployment URL, Actions run, stage, and expected/observed SHA
with the release record. A passing preview check is not production evidence.

These checks do not prove field-device behavior, field Core Web Vitals, search
indexing, or every external network condition. No production or preview host
check should be marked complete until it was run against the specified live
deployment.
