# RubyGems VCR fixtures

`cassettes/` contains one read-only capture of the public RubyGems compact
index and gem-file endpoints for `rainbow 3.1.1`, `pastel 0.8.0`, and its
`tty-color 0.6.0` dependency, plus one real missing-index 404 and one missing
`.gem` 403. The capture metadata, normalized response headers, byte counts,
SHA-256 hashes, recording time, package licenses, and retained license texts
are in `cassettes/manifest.json`.

The `.gem` archives include their MIT license files. The response-header
allowlist omits request IDs, host IDs, timestamps, cache-node names, and other
per-request infrastructure headers. The missing `.gem` XML replaces volatile
`RequestId` and `HostId` values with fixed fixture values; both its captured
and replay body hashes are recorded.

The cassette server reads only those files. It does not call RubyGems or fall
back to the network. The Wrangler test Worker accepts only the fixed
`https://rubygems.org` upstream from the production route factory and maps its
path to `http://127.0.0.1:18787`. The production Worker still uses its fixed
RubyGems origin.

Normal `npm run proxy:e2e` and browser E2E runs replay the checked-in cassettes.
They never record. To intentionally refresh the fixed, unauthenticated public
GET set, run this explicit opt-in command from the repository root:

```sh
RUBYGEMS_CASSETTE_RECORD=1 npm --prefix proxy run record:fixtures
```

The recorder has a fixed path allowlist, requests identity encoding, follows
redirects, retries zero times, prints only status, byte count and body hash,
and excludes dynamic headers. It normalizes the two volatile XML identifiers
in the missing `.gem` response.
If any endpoint returns a different status, it aborts before updating cassette
files.

The local-only fault controls are `POST /__faults` with a JSON body such as
`{"path":"/info/rainbow","kind":"not-found"}` or
`{"path":"/gems/rainbow-3.1.1.gem","kind":"corrupt"}`, and `POST /__reset`.
Faults apply only to that exact path until reset. The `delay` fault on
`/info/rainbow` waits 10 seconds by default before replaying the recorded
response; disconnecting the request cancels its timer. The `corrupt` fault
returns the first 128 bytes of the recorded gem archive.
