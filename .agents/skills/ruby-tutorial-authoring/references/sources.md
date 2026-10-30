# Sources and original examples

## Match references to learning goals

Inspect the explanation, Example and each Experiment before choosing links. Read the destination's actual content. HTTP success proves reachability only; it does not prove that a page supports the lesson's claims.

- Use syntax chapters for language constructs and class/module API pages for method behavior. A page named Operators is not necessarily a comparison-operator reference; Integer documents integer comparisons.
- Prefer direct method anchors for focused API behavior, such as Kernel#puts, Class#new invoking initialize, and Module#attr_reader. Inspect `src/tutorial/references.ts` for supported reference identifiers before authoring a new one; update its mapping when needed.
- Verify version-specific paths and anchor existence. Older manuals may group the same construct elsewhere; update both URL and visible label without changing the tutorial chapter.
- Link release notes for introduction dates. A link to a named release can intentionally differ from the selected runtime's manual version when it supports a historical introduction claim; label it explicitly.
- Distinguish Ruby guarantees from host behavior. Worker termination, filesystem limitations and browser execution require implementation/runtime evidence, not only the Ruby manual.

For a reference audit, report semantic correspondence, reachability/anchors and version coverage separately. Report dated findings with the task; keep reusable rules here instead of accumulating historical reports in `docs/`. Do not declare all references correct from status codes alone.

Reference books may inform broad prerequisite progression. Do not reproduce distinctive tables of contents, organization, prose or examples. Author independent examples for this browser environment. Official syntax classifications substantiate claims; they do not define the curriculum. Keep authoring methodology out of learner-facing copy.
