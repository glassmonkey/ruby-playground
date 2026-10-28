> Correction: the initial audit below checked relevant content and link availability but missed that Code Layout did not support the output lesson’s main learning goal. That conclusion was insufficient. The retained output material references Kernel#puts and Kernel#p plus Comments. It is now excluded from the syntax course; its old route redirects to the first syntax lesson. Code Layout is taught by its own dedicated lesson. Both method anchors were checked in 3.2, 3.3, 3.4, 4.0 and master.

# Ruby Playground official-reference audit

Target: `/tmp/ruby-playground-seo-pr` working tree. Read-only review of generated tutorial references and `content/tutorial.json`, `content/tutorial-versions.json`, `scripts/generate-tutorial.mjs`.

## Counts

- 87 distinct `https://docs.ruby-lang.org` URLs appear in generated lesson HTML.
- All 87 returned HTTP 200 to read-only `curl -I -L` requests on 2026-10-28.
- 115 official-reference link occurrences were found across generated HTML.
- The same five reference namespaces are used throughout: 3.2, 3.3, 3.4, 4.0, and `master` (the 4.1 development course).

## Semantic findings

Four link occurrences have visible labels that do not match the destination's actual page title:

1. **Ruby 3.2, 3.3, and 3.4 `output` lesson:** the visible reference is “Code Layout,” but the generator override points to `syntax/miscellaneous_rdoc.html`, whose official page title is “Miscellaneous Syntax.” The page does include expression line breaks and indentation, so the URL is relevant, but the label implies a dedicated Code Layout page that these versions do not have. The override is in `scripts/generate-tutorial.mjs` (`referenceOverrides`). Verified on official [Ruby 3.2 Miscellaneous Syntax](https://docs.ruby-lang.org/en/3.2/syntax/miscellaneous_rdoc.html) and [Ruby 3.3 Miscellaneous Syntax](https://docs.ruby-lang.org/en/3.3/syntax/miscellaneous_rdoc.html).
2. **Ruby 3.2 `operators` lesson:** the visible reference is “Operators,” but it targets `syntax/methods_rdoc.html`, titled “Methods.” This is an intentional older-version mapping: the page does cover operator method names and behavior (official page lines 59 onward), while a separate precedence page is also linked. Label it as the Methods section or “Operator methods” to avoid suggesting a standalone Operators chapter. Verified on [Ruby 3.2 Methods](https://docs.ruby-lang.org/en/3.2/syntax/methods_rdoc.html).

The Ruby 3.2 operator target is semantically relevant; this is a page-label mismatch rather than a broken or irrelevant target. No other concrete label-to-destination mismatch was found in the refs list.

## Version notes / claims

- The blocks lesson's Ruby 3.2 and 3.3 variants replace `it` with explicit block parameters and explicitly say the implicit parameter is unavailable in those versions.
- Stable 3.4 and 4.0 and the master/development lesson use `it`, and the lesson states it was introduced in Ruby 3.4. The generated blocks page links the 3.4 NEWS page for that claim. The statement is consistent with the release documentation: [Ruby 3.4 release notes](https://docs.ruby-lang.org/en/3.4/NEWS_md.html).
- The 4.1 course reference namespace is `master`, as set by `content/tutorial-versions.json`; generated pages label it development rather than presenting master as a stable release.

## Smallest fix

Keep the URLs. Add a display-label override in `scripts/generate-tutorial.mjs` for legacy destination mappings:

- For `Code Layout` on 3.2/3.3/3.4, display “Miscellaneous Syntax (includes Code Layout)” (or equivalent).
- For `Operators` on 3.2, display “Methods (operator methods)” (or equivalent).

This fixes all four label mismatches without changing the lesson-reference schema or the valid destinations. A longer-term option is to store reference display text separately from the lookup key so version-specific labels are explicit in the source data.

## Resolution

The generator now displays `Miscellaneous Syntax (code layout)` for the three legacy layout mappings and `Methods (operator methods)` for Ruby 3.2. Destination URLs are unchanged.
