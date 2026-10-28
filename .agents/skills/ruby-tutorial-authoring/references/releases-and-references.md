# Releases and official references

## One runtime catalog

`src/versions.ts` is the executable source of truth for supported Ruby minor IDs, actual bundled patch versions, stable/development channels and official-documentation namespaces. The application selector, tutorial selector, default course, page generation and build inputs consume that catalog. Do not create a tutorial-only version list or separately maintained default. Both surfaces choose the newest supported stable entry; development builds remain selectable but do not become the default. Use concrete version labels rather than a visible “latest” label.

When adding a release:

1. Pin its bundled WASM dependency and add its Worker URL to the `Record<RubyVersion, string>` map in `src/workers/ruby-worker.ts`. The typed map must cover every selectable version.
2. Verify `RUBY_VERSION` from the bundled runtime. Update the shared release metadata; a package name or minor label is not proof of the patch version. Stable references normally use their version namespace; a development release may use `master`, explicitly labeled development.
3. Review every inherited lesson and Experiment for that version. Use complete field overrides where syntax or behavior differs. Keep chapter order and stable lesson IDs shared across versions. A documentation move does not make a lesson unavailable.
4. Regenerate routes and sitemap, run type/build checks, and verify both selectors expose the same IDs and default. Test tutorial-to-Playground handoff and actual execution for the new version. Do not publish a selectable course without a bundled runnable version.

## Match references to learning goals

Inspect the explanation, Example and each Experiment before choosing links. Read the destination's actual content. HTTP success proves reachability only; it does not prove that a page supports the lesson's claims.

- Use syntax chapters for language constructs and class/module API pages for method behavior. A page named Operators is not necessarily a comparison-operator reference; Integer documents integer comparisons.
- Prefer direct method anchors for focused API behavior, such as Kernel#puts, Class#new invoking initialize, and Module#attr_reader. Inspect `src/tutorial/references.ts` for supported reference identifiers before authoring a new one; update its mapping when needed.
- Verify version-specific paths and anchor existence. Older manuals may group the same construct elsewhere; update both URL and visible label without changing the tutorial chapter.
- Link release notes for introduction dates. A link to a named release can intentionally differ from the selected runtime's manual version when it supports a historical introduction claim; label it explicitly.
- Distinguish Ruby guarantees from host behavior. Worker termination, filesystem limitations and browser execution require implementation/runtime evidence, not only the Ruby manual.

For a reference audit, report semantic correspondence, reachability/anchors and version coverage separately. Report dated findings with the task; keep reusable rules here instead of accumulating historical reports in `docs/`. Do not declare all references correct from status codes alone.
