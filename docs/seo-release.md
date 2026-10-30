# SEO release notes

The root page's initial HTML includes an English description before JavaScript
or the Ruby WebAssembly runtime loads. Its static H1 is “Try Ruby in your
browser”; after React mounts, the application header is one H1, “Ruby
Playground”. The document title is “Ruby Playground – Run Ruby Online in Your
Browser”. Root-page Open Graph and Twitter metadata are generic and contain no
shared query, user code, or execution result.

Tutorial pages are rendered from resolved lesson data during the shared build
and by the development server. Each versioned course and article has its own
canonical URL, title and social metadata. Tutorial PNG cards derive from the
resolved lesson title and Example code, together with the release label;
development status remains visible. Article code on these cards is authored
lesson content, not a visitor's edits or execution results. Alias pages point
to their destination canonical and are excluded from indexing.

Canonical URLs and the robots sitemap entry use the production origin
`https://ruby-play.dev`. The sitemap contains the root and available versioned
course and article URLs, excluding aliases and unavailable lessons. Its XML is
served directly in development and emitted by the production build. Canonical
URLs do not include share queries.

The initial HTML sets `no-referrer` so shared query content is not sent as a
referrer to linked destinations. This does not mean the URL is never transmitted
or retained elsewhere: a shared URL contains its code, and browser history,
copied messages, recipients, and hosting request logs are separate systems.
GitHub says it logs and stores visitor IP addresses for security purposes;
query retention details are not established here.

The early head module adds `noindex` when any `c`, `v`, or `f` share parameter is
present, including an empty value. It updates the policy for `pushState` and
`popstate`, and removes its own `noindex` tag on a URL without those parameters.
The head module is a deferred JavaScript module; the initial HTTP HTML does not
vary by query. GitHub Pages cannot vary response headers by query string, and
crawlers may not execute JavaScript consistently. This client-side policy
therefore does not guarantee exclusion of shared URLs from search results.

The site is served at the host root, so `https://ruby-play.dev/robots.txt` is
the host's crawler policy, as Google requires. It allows every path and lists
the sitemap. No rule in this file blocks JavaScript, CSS, or share URLs.
Sitemap discovery and registration must be checked after publication.

## Local verification

Run `npm run check`, then build and inspect the preview. Check the raw HTML
for the title, description, canonical, referrer policy, static H1, and
script/resource paths. Request `/sitemap.xml` directly in development and
production preview and verify XML rather than the application fallback. Check
versioned tutorial canonicals and image URLs, including development labels and
alias query/fragment preservation. Check the rendered DOM for the React heading and noindex behavior on shared and
ordinary URLs. Browser checks demonstrate local behavior only. They do not
verify crawler execution, sitemap discovery, indexing outcomes, or behavior on
the public host. After publication, verify the real host's root robots response
and submit or inspect the sitemap in the applicable search console.

References: [Google robots.txt location requirements](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)
and [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection).
