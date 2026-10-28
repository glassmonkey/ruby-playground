# Ruby tutorial content evaluation

Use this rubric for an explicit review or after creating/updating lessons. Evaluate the learner-visible page and the source data that produced it. Tests and schema validation are evidence about implementation, not a substitute for checking factual accuracy or teaching quality.

## Gather evidence

- Read the reviewed lesson and its relevant neighboring lessons. Check the current version catalog, resolver and page generator.
- For each version claim, consult the official version-specific Ruby reference and NEWS. Record direct source links and the claim they support.
- Resolve and inspect each supported version separately, including overridden code, rather than assuming the shared starter represents every variant. If runtime checks are unavailable, do not conclude version compatibility from a base-lesson inspection.
- Run each lesson's exact code through the bundled WASM runtime for every claimed course version. Record actual `RUBY_VERSION` and output; compare output line by line with the authored expected output.
- Open the real page at its versioned route. Confirm its visible version, course content, starter code and selected runtime agree. Check the header selector, navigation, aliases and unavailable lessons against the current implementation.
- Use the on-page editor to run the starter example and perform the lesson task. Check that the task is meaningful, the feedback matches the observed behavior, and the full Playground handoff preserves edited code and version.
- Check learner-facing text and the shared theme behavior. The page should not display an author completeness checklist, coverage matrix, remaining-topic inventory or explanation of the author's methodology. Theme selection should agree with the main Playground and survive lesson/version navigation without clearing edits.

When a check cannot be performed, identify it as unverified and explain its effect on the conclusion. Do not infer runtime output from a local system Ruby or from the version label alone.

## Blocking findings

Report a blocker when evidence shows any of the following:

- A Ruby language/API claim contradicts official documentation, describes a feature in the wrong version, or presents an unverified version-sensitive claim as fact.
- Example code fails in the claimed bundled runtime, its real output differs from the expected output, or the page runs it on a different version than the selected course.
- A versioned route, redirect/alias, course navigation, selector, or unavailable state serves content or starter code for the wrong version, drops the route, or promises a lesson that is not available.
- A source reference resolves to the wrong Ruby version or fails to support the claim it accompanies.
- The interface displays “latest” as a version, labels a development build as stable, or otherwise makes the selected Ruby version materially ambiguous.

Distinguish observed failures from evidence gaps. A failed runtime or route check is a blocker. An unavailable source or inaccessible preview is an unverified risk unless other evidence demonstrates a defect.

## Teaching-quality review

After blockers, assess these dimensions and recommend only improvements that materially help the learner:

- **Goal and sequence:** The lesson teaches one usable outcome, names needed concepts before relying on them, and follows naturally from prerequisites.
- **Explanation:** The prose explains what the learner needs to understand to predict the example. It avoids incidental API catalogs and unsupported generalizations.
- **Experiment:** The starter is short enough to inspect, runs in the inline editor on demand, and makes a behavior visible. The task asks for a purposeful edit or prediction.
- **Feedback:** The answer explains why the result occurs and addresses the task. The pitfall identifies a plausible learner error and gives a correction.
- **Version fit:** Shared content is valid for all versions that inherit it. Variants replace complete fields where required, especially paragraph arrays. Development-specific behavior is labeled clearly.
- **Learner-facing focus:** Keep only material that helps the learner understand and practice the lesson. Remove author-side coverage accounting, exhaustive/complete claims, “what remains” lists and authoring-process commentary from the page.
- **Course experience:** The lesson works within the sidebar/progress and cohesive flow of the existing tutorial UI. Keep version selection, runtime and starter content aligned; preserve edits when switching theme. Do not request UI redesign in a content-only review unless the observed UI defect blocks the lesson.

## Report format

Start with the review conclusion: blockers found or none found. For each finding, include:

1. **Severity:** Blocker or improvement.
2. **Location:** Lesson slug, version and field or page section.
3. **Evidence:** Exact observed behavior/output or a link to the official version-specific source.
4. **Consequence:** What the learner will misunderstand, fail to run or lose.
5. **Action:** The smallest concrete correction that resolves it.

Then summarize the versions and routes actually checked, remaining unverified items, and a short prioritized set of teaching improvements. Do not assign a pass solely because automated checks passed; do not rewrite source during a review unless the user also asked for fixes.
