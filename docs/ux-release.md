# UX release notes

The initial HTML provides one static H1 and a readable description before
JavaScript loads. After React mounts, its “Ruby Playground” header is the
single H1. The editor and output are named sections, and the safety,
privacy, and license destinations are grouped in a labelled footer navigation.
The title contract remains `Ruby Playground`.

The release E2E retains the existing three user flows and adds a focused layout
and keyboard check. It verifies the first keyboard stop, named regions and
navigation, and horizontal overflow at 640 CSS pixels (a viewport-width proxy
for a 1280 CSS-pixel desktop at 200% zoom) and 390 CSS pixels. Playwright does
not change the host browser's actual zoom setting; the proxy does not replace a
manual assistive-technology or device check.

## Local Chromium measurements

Measurements below came from the local production preview on Desktop Chrome
(`navigator.platform=MacIntel`), 1280×900 CSS pixels, Node 24.19.0/npm 11.17.0.
The cold test used a fresh Playwright browser context, disabled HTTP cache, and
CDP network emulation at 4 Mbps down / 512 Kbps up / 100 ms. It held the app
entry bundle for 1.5 seconds while checking that the initial static description
was visible; this deliberate hold is not a natural FCP measurement.

| Flow                                            | Result                                                          |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Static explanation with entry bundle held       | Visible at 350 ms                                               |
| Editor ready on fresh 4 Mbps / 100 ms           | 4,744 ms                                                        |
| First Ruby run on fresh 4 Mbps / 100 ms         | Failed at 20,531 ms with the app's 20-second timeout; no output |
| Stop after restoring network                    | 62 ms from click to stop alert                                  |
| Recovery Ruby run after restoring network/cache | 952 ms; output verified                                         |
| Warm short Ruby run                             | 1,033 ms; output verified                                       |
| CSS viewport layout checks                      | No horizontal overflow at 640 and 390 CSS px                    |

The same measured flow against the separately built `/ruby-playground/` preview
produced:

| Flow                                    | Result                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| Static explanation with entry held      | Visible at 193 ms                                               |
| Editor ready on fresh 4 Mbps / 100 ms   | 4,557 ms                                                        |
| First Ruby run on fresh 4 Mbps / 100 ms | Failed at 20,475 ms with the app's 20-second timeout; no output |
| Stop after restoring network            | 62 ms from click to stop alert                                  |
| Recovery Ruby run                       | 940 ms; output verified                                         |
| Warm short Ruby run                     | 1,043 ms; output verified                                       |
| CSS viewport layout checks              | No horizontal overflow at 640 and 390 CSS px                    |

The first cold Ruby run is a recorded failure; the later successful recovery is
separate evidence. These values supersede an earlier local run because build and
browser cache state varied. The local build includes a 32.6 MB Ruby WASM file and emits a
large-chunk warning. Do not treat these local timings as CDN or Core Web Vitals
evidence. Real devices, real host/CDN behavior, and field p75 remain
unverified. A first-run load or runtime timeout must remain a failure with its
actual elapsed time and recovery behavior; do not remove an assertion or widen
the application's execution timeout to produce a pass.

Keyboard checks verified that Tab moves focus out of Monaco to the next safety
link. With the Clipboard API's write operation forced to reject, focusing the
share URL selected its full value and the platform shortcut copied it; this
browser reports `MacIntel`, so the check used Meta+C. On the root production
build, the existing Ruby flows ran 3/3 in Firefox and 3/3 in WebKit; the
project-base Chromium suite passed 7/7. The editor
test uses Meta+A when the browser UA contains `Macintosh`, otherwise Control+A.
WebKit reports the Ruby worker script as an `xhr` request and the WASM as
`fetch`; the network collector records all request URLs and types, then checks
HTTP(S) same-origin base-prefix paths. `about:` and `blob:` URLs are recorded
separately from network delivery paths. These are local preview results; public
host and physical-device behavior remain unverified.

The generated full share URL is limited to 8,000 UTF-8 bytes, based on the
candidate host's measured transport boundary. The existing query and hash stay
intact. If the complete URL exceeds the limit, sharing is refused with an alert
and the code remains in the editor. A runnable program may still be too long to
share.

Footer targets are relative to the current project base path so they work at
both `/` and `/ruby-playground/`. The security lane supplies the linked static
pages; the integration E2E must confirm they resolve from both previews.
