# GitHub Pages release runbook

This repository change prepares a GitHub Pages artifact and a manually gated
release workflow. It does not change repository settings, dispatch the workflow,
or publish the site. The proposed, currently unpublished URL is
<https://glassmonkey.github.io/ruby-playground/>. The formal public URL and
delivery-cost limit remain owner decisions tracked by
[GLA-89](https://linear.app/glassmonkey/issue/GLA-89).

## Gates before a production release

Keep the site unpublished until all of these are recorded and accepted:

- GLA-89 selects the formal host/URL and sets an acceptable WASM delivery-cost
  limit. GitHub Pages is the implementation target for this PR, not a decision
  about a custom domain or a cost ceiling.
- GLA-90, GLA-91, and GLA-92 meet their acceptance criteria. GLA-93 may prepare
  staging before those three finish, but production promotion waits for all
  three and an explicit owner approval.
- The owner confirms the Pages source is **GitHub Actions** and configures the
  `github-pages` environment with required reviewers and a deployment branch
  rule restricted to `main`. Do this in repository settings only after the
  owner approves the release setup; this PR does not edit settings.
- A reviewer verifies the selected source SHA, the built artifact, the release
  checklist below, and the rollback target before approving deployment.

## Build and verify without publishing

The pull request CI runs `npm ci`, `npm run check`, then the three Chromium E2E
flows against both the root path and `/ruby-playground/`. It installs the
repository-pinned Node version from `.node-version` and npm 11.17.0.

After merge, open **Actions → Pages release → Run workflow** on `main`. Keep
**Deploy the built artifact** unchecked to build, test, and upload the static
artifact without deploying. The workflow verifies that `release_sha` is a full
commit SHA reachable from `main`; leave it empty for the current `main` commit.
The uploaded `public/` artifact contains `release-info.json` with the source
SHA and `/ruby-playground/` base path. The workflow requests seven days of
artifact retention; this is temporary storage, not a durable release archive.
Save the Actions run URL and artifact locator alongside that SHA for review.

## Release checklist

Before checking the `publish` input:

1. Confirm the default branch and workflow ref are `main`, and that the
   `github-pages` environment's required reviewers and branch restriction are
   active.
2. Confirm GLA-89's URL/host and cost decision, GLA-90/91/92 acceptance, and the
   owner's explicit production approval. Record unresolved items instead of
   treating a successful build as release approval.
3. Review the artifact's `release-info.json` and verify its source SHA matches
   the reviewed commit. Preserve the Actions run and artifact locator.
4. Only the authorized owner/reviewer checks **Deploy the built artifact**.
   The deploy job only runs for this input on `main`, uses the `github-pages`
   environment, and receives `pages: write` and `id-token: write`. PR CI has
   neither permission.
5. After an approved deployment, record the deployment URL and SHA. On the real
   host, verify HTTPS, `/ruby-playground/`, JavaScript/Worker/WASM/Monaco
   responses and MIME types, Ruby output/error/Stop/recovery, shared URL direct
   load and reload without auto-run, long/Unicode share URLs, HTML output,
   caching, and missing-path behavior. These host checks are not covered by
   local preview or CI.

## Rollback

Use the SHA of the last known-good deployment, recorded in its `release-info.json`
and Actions run. On `main`, run **Pages release** with that full `release_sha` and
leave `publish` unchecked first. If the previous Actions artifact has expired,
rebuild from that same verified SHA, confirm the new artifact's
`release-info.json`, and obtain a new environment approval before checking
`publish`. Artifacts expire after seven days and are not guaranteed to remain
available; the workflow does not promise permanent artifact storage. Rebuilding
from the same source SHA with the locked dependencies restores the same source
revision, but is a new build and approval. It does not merge or reset branches.

After rollback, repeat the real-host smoke checks and record the resulting URL,
workflow run, and SHA. Confirm the restored HTML points only to assets present
in that artifact. GitHub Pages does not provide repository-controlled
per-file cache headers through this workflow, so account for stale HTML and
asset cache behavior during the smoke check. Do not delete or overwrite the
last known-good run/artifact before confirming the rollback.

## Current unverified work

No repository Settings change, workflow dispatch, staging deployment, production
deployment, real-host smoke test, or rollback trial has been performed as part
of this PR. The corresponding GLA-89/90/91/92 decisions and checks remain open
release gates.
