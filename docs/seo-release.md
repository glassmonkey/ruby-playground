# SEO release notes

The initial HTML includes a Japanese description that explains the playground
without waiting for JavaScript or the Ruby WebAssembly runtime. It contains one
static H1, “ブラウザで Ruby を試す”; after React mounts, the application header
is one H1, “Ruby Playground”. The document title remains “Ruby Playground”.
Open Graph and Twitter metadata are fixed and generic; they contain no shared
query, user code, or execution result.

The canonical URL, sitemap, and robots sitemap entry use the candidate URL
`https://glassmonkey.github.io/ruby-playground/`. This is not yet a published or
owner-approved production URL. The canonical is queryless and the sitemap lists
only the top-level page. The generic description does not include shared code or
execution output. The initial HTML sets `no-referrer` so shared query content is
not sent as a referrer to linked destinations. This does not mean the URL is
never transmitted or retained elsewhere: a shared URL contains its code, and
browser history, copied messages, recipients, and hosting request logs are
separate systems. GitHub says it logs and stores visitor IP addresses for
security purposes; query retention details are not established here.

The early head module adds `noindex` when any `c`, `v`, or `f` share parameter is
present, including an empty value. It updates the policy for `pushState` and
`popstate`, and removes its own `noindex` tag on a URL without those parameters.
The head module is a deferred JavaScript module; the initial HTTP HTML does not
vary by query. GitHub Pages cannot vary response headers by query string, and
crawlers may not execute JavaScript consistently. This client-side policy
therefore does not guarantee exclusion of shared URLs from search results.

The repository artifact includes `robots.txt` at the project path. Google
requires a `robots.txt` file at the host root, so
`https://glassmonkey.github.io/ruby-playground/robots.txt` does not control the
host's crawler policy. This project cannot set the root file through its Pages
project path. The candidate sitemap can be served under the project path, but
its discovery and registration must be checked after publication. The included
robots file is informational for this project artifact; do not report its
allow rule or sitemap line as active crawler configuration. No rule in this
file blocks JavaScript, CSS, or share URLs.

## Local verification

Run `npm run check`, then build and inspect both the root preview and the
`/ruby-playground/` project-path preview. Check the raw HTML for the title,
description, canonical, referrer policy, static H1, and script/resource paths;
check the rendered DOM for the React heading and noindex behavior on shared and
ordinary URLs. Browser checks demonstrate local behavior only. They do not
verify crawler execution, sitemap discovery, indexing outcomes, or behavior on
the public host. After publication, verify the real host's root robots response
and submit or inspect the project sitemap in the applicable search console.

References: [Google robots.txt location requirements](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)
and [GitHub Pages data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection).
