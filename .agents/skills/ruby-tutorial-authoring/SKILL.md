---
name: ruby-tutorial-authoring
description: Create or revise Ruby tutorial lesson JSON, explanations, Examples and Experiments within the established curriculum. Use for lesson editing and generation; use curriculum for course restructuring, versioning for release rollout, and review for read-only evaluation.
---

# Ruby tutorial authoring

Use this skill for lesson creation and editing within established course goals. Respect the user's editing and publication scope. Do not publish, commit or push without authorization.

## Select and combine responsibilities

- Routine lesson additions and revisions stay here. Apply the existing [placement criteria](../ruby-tutorial-curriculum/references/placement.md); do not redesign chapters merely because a lesson is new.
- Changing chapter purpose, boundaries or prerequisite order uses [curriculum](../ruby-tutorial-curriculum/SKILL.md).
- Adding runtime/course support uses [versioning](../ruby-tutorial-versioning/SKILL.md).
- A read-only evaluation uses [review](../ruby-tutorial-review/SKILL.md). For an authorized review-and-fix request, identify findings first, then perform edits under the relevant editing responsibility.

Use only responsibilities needed by the request. A combined request can pass placement decisions and release constraints into authoring without repeating completed checks or inventing new approval steps.

## Two-stage workflow

The repository copy of this skill is authoritative. Use structured lesson data as the source of truth, not generated HTML. “Structured data” here means the authoring model, not SEO JSON-LD.

- **Create or revise lesson data:** read [the data contract](references/data-contract.md), then follow the authoring instructions below. Deliver changes to `src/tutorial/data/lessons.json` and, only when needed, the shared chapter/redirect data or version catalog. Run `npm run tutorial:validate` before handoff. Evaluate factual accuracy, learning sequence and experiment/feedback alignment before rendering. Do not introduce layout or HTML into lesson strings.
- **Build pages from approved lesson data:** read [page generation](references/page-generation.md). Run the existing `npm run build`; its Vite plugin deterministically renders the common React UI and bundles the application. Do not paraphrase, add claims, or independently author a second copy of the lesson during generation. If data is incomplete or incorrect, fix it in the first stage and regenerate.
- **End-to-end lesson addition:** perform both stages and their separate checks. A request for data only does not require publishing pages; a request to regenerate pages does not authorize rewriting the curriculum.

The handoff is the lesson JSON diff, affected versions and evidence from content evaluation. Generated HTML is a derived artifact. Data structure checks, teaching-quality review and rendered-page checks answer different questions; report which were actually performed.

## Establish current project facts

Inspect the current lesson data, version catalog, resolver, build plugin, README and relevant browser UI before editing. Likely sources are `src/tutorial/data/lessons.json`, `src/versions.ts`, `src/tutorial/content.ts`, `src/tutorial/data/chapters.json`, `src/build/tutorial-plugin.ts`, `src/tutorial/references.ts`, `src/tutorial/components/` and `src/tutorial/app.tsx`; verify paths because implementation can change. Keep edits within the requested content scope. Do not redesign the site UI or alter tests unless requested.

The course is versioned at `/tutorial/{version}/{slug}/`. Discover the course entry/default and alias resolution in the current implementation; do not infer it from an alias name. The UI must show concrete Ruby version numbers, with development releases marked separately; never expose a `latest` badge or label. The header version selector changes the course, starter code and runtime together. The inline editor runs only when its Run control is pressed. Its runtime follows the selected course version. The full Playground link carries the current edits and selected version into a new tab.

Discover the shared theme preference and its storage implementation. Check that Light/Dark mode stays synchronized across both surfaces and lesson/version navigation, and that changing theme preserves edited code. Follow the existing tutorial UI patterns, including any local PHP tutorial reference if present; do not assume that reference exists or change UI implementation as part of a content-only request.

## Placement and evidence

Use [placement criteria](../ruby-tutorial-curriculum/references/placement.md) for the lesson's prerequisites and chapter fit. Follow [source standards](references/sources.md) for official references and independent examples. These references own their respective criteria; do not duplicate them as current chapter or version tables.

## Author or update content

1. Identify the learner's immediate goal and prerequisite lesson. Keep the lesson language and voice consistent with neighboring lessons. Build a coherent progression: Example demonstrates the basic, representative form of the concept; Experiment lets the learner apply it by varying conditions or usage. A basic example need not be the shortest possible snippet. Let the learner discover results by running code; do not display expected results or answer disclosures. Retain output and answer data for author-side validation.
2. Verify version-sensitive statements against the official Ruby documentation and NEWS for each affected version. Check syntax and API introduction/behavior in the specific version's sources; section names and URLs can differ for older versions. Prefer linked primary sources. If a source cannot be checked, say so instead of presenting a guess as fact.
3. Run examples in the actual bundled WASM runtime selected by the course version. Inspect its actual `RUBY_VERSION`; a minor label or npm wrapper version does not establish the bundled patch release. Capture the real output and make the expected output match exactly. Run the same code on each version variant it claims to support.
4. Discover the executable data contract and consumers using [data editing](references/data-contract.md). Do not copy the current field list or merge semantics into authoring policy. Keep syntax, core API and standard-library claims distinct.
5. Resolve every affected version after editing; verify inherited explanations, code, experiments and availability as a whole. Follow [versioning](../ruby-tutorial-versioning/SKILL.md) for runtime registration and publication effects.
6. Make a learner's experiment meaningful and easy to run in the on-page editor. The task should target the stated goal, invite a prediction or concrete edit, and have an answer that explains the observed result. Identify a likely misconception with a specific correction. Keep official references useful to that lesson and version. Scope simplified explanations to the example when broader Ruby behavior differs. Use concrete executable syntax in prose rather than placeholders that are themselves Ruby syntax (for example, explain super(text) using that exact call).

## Verify and report

Use the project's relevant checks and browser preview, but do not treat a green test suite as evidence that explanations teach well or that version-specific claims are true. Verify rendered content and routes in the actual preview. Exercise the lesson's Run button, version selector, full Playground handoff, theme toggle and theme persistence where relevant. Check that lesson text and code still read without JavaScript.

Do not expose author-side completeness tracking in learner-facing copy: omit coverage/completeness claims, lists of remaining topics, and descriptions of the author's methodology. Keep the public lesson focused on the learner's goal, explanation, code experiment and hands-on application. Do not add completion counters, progress storage or mark-complete controls. Use the [evaluation rubric](../ruby-tutorial-review/references/evaluation.md) to identify content defects and actionable improvements. Report changed files, official evidence, actual runtime versions/output, checks performed, unresolved uncertainties and prioritized findings. Do not claim a check that was not run.
