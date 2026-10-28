---
name: ruby-tutorial-authoring
description: Author, update, and evaluate versioned Ruby tutorial lessons in this repository, including release reviews.
---

# Ruby tutorial authoring

Use this skill to create or update course content, roll the course forward for a Ruby release, or evaluate existing lessons. Read [the evaluation rubric](references/evaluation.md) for review requests and for the quality pass after authoring. Treat the user's requested scope and publication permissions as authoritative; do not publish, commit, or push unless asked.

## Two-stage workflow

The repository copy of this skill is authoritative. Use structured lesson data as the source of truth, not generated HTML. “Structured data” here means the authoring model, not SEO JSON-LD.

- **Create or revise lesson data:** read [the data contract](references/data-contract.md), then follow the authoring instructions below. Deliver changes to `content/tutorial.json` and, only when needed, the version catalog. Evaluate factual accuracy, learning sequence and experiment/feedback alignment before rendering. Do not introduce layout or HTML into lesson strings.
- **Build pages from approved lesson data:** read [page generation](references/page-generation.md). Use the existing deterministic generator and common UI. Do not paraphrase, add claims, or independently author a second copy of the lesson during generation. If data is incomplete or incorrect, fix it in the first stage and regenerate.
- **End-to-end lesson addition:** perform both stages and their separate checks. A request for data only does not require publishing pages; a request to regenerate pages does not authorize rewriting the curriculum.

The handoff is the lesson JSON diff, affected versions and evidence from content evaluation. Generated HTML is a derived artifact. Data structure checks, teaching-quality review and rendered-page checks answer different questions; report which were actually performed.

## Establish current project facts

Inspect the current lesson data, version catalog, resolver, generator, README and relevant browser UI before editing. Likely sources are `content/tutorial.json`, `content/tutorial-versions.json`, `src/tutorial-content.ts`, `scripts/generate-tutorial.mjs` and `src/tutorial*.tsx`; verify paths because implementation can change. Keep edits within the requested content scope. Do not redesign the site UI or alter tests unless requested.

The course is versioned at `/tutorial/{version}/{slug}/`. `/tutorial/` resolves through the internal `latest` alias to the latest supported stable course. The UI must show concrete Ruby version numbers, with development releases marked separately; never expose a `latest` badge or label. The header version selector changes the course, starter code and runtime together. The inline editor runs only when its Run control is pressed. Its runtime follows the selected course version. The full Playground link carries the current edits and selected version into a new tab.

Tutorial and Playground share the `chakra-ui-color-mode` preference. Check that Light/Dark mode stays synchronized across both surfaces and lesson/version navigation, and that changing theme preserves edited code. Follow the existing tutorial UI patterns, including any local PHP tutorial reference if present; do not assume that reference exists or change UI implementation as part of a content-only request.

## Author or update content

1. Identify the learner's immediate goal and prerequisite lesson. Keep the lesson language and voice consistent with neighboring lessons. Build a coherent progression: explain one idea, demonstrate it, let the learner change or predict behavior, then explain the result.
2. Verify version-sensitive statements against the official Ruby documentation and NEWS for each affected version. Check syntax and API introduction/behavior in the specific version's sources; section names and URLs can differ for older versions. Prefer linked primary sources. If a source cannot be checked, say so instead of presenting a guess as fact.
3. Run examples in the actual bundled WASM runtime selected by the course version. Inspect its actual `RUBY_VERSION`; a minor label or npm wrapper version does not establish the bundled patch release. Capture the real output and make the expected output match exactly. Run the same code on each version variant it claims to support.
4. Inspect the current TypeScript lesson type before changing JSON fields. Existing lesson data uses `title`, `chapter`, `goal`, `paragraphs`, `code`, `output`, `task`, `answer`, `pitfall`, `refs` and may include fields such as `remaining` or `versionNote`; only add or remove fields according to the current consumer. Keep language syntax, core API and standard-library use distinct in explanations.
5. Shared lessons may define `variants` keyed by version. Variants are shallow overrides: an overridden `paragraphs` array replaces the whole array. Include every paragraph needed for that version, and align its code, output, task, answer, pitfall and version note. Use `available: false` when a lesson cannot be taught for a version; verify the current generator's unavailable-page, course-list and sitemap behavior.
6. Make a learner's experiment meaningful and easy to run in the on-page editor. The task should target the stated goal, invite a prediction or concrete edit, and have an answer that explains the observed result. Identify a likely misconception with a specific correction. Keep official references useful to that lesson and version. Scope simplified explanations to the example when broader Ruby behavior differs. Use concrete executable syntax in prose rather than placeholders that are themselves Ruby syntax (for example, explain super(text) using that exact call).

For a new release, audit all lessons for changed syntax, behavior and APIs before changing the catalog. Keep development releases in their separate channel. Change `content/tutorial-versions.json`'s `latest` only after every supported runtime and affected lesson has been verified. Preserve version-specific URLs and test legacy aliases. Never edit generated `tutorial/` HTML directly; inspect the generator first because generation may delete and recreate that directory.

## Verify and report

Use the project's relevant checks and browser preview, but do not treat a green test suite as evidence that explanations teach well or that version-specific claims are true. Verify rendered content and routes in the actual preview. Exercise the lesson's Run button, version selector, full Playground handoff, theme toggle and theme persistence where relevant. Check that lesson text and code still read without JavaScript.

Do not expose author-side completeness tracking in learner-facing copy: omit coverage/completeness claims, lists of remaining topics, and descriptions of the author's methodology. Keep the public lesson focused on the learner's goal, explanation, code experiment and useful feedback. Use the evaluation rubric to identify content defects and actionable improvements. Report changed files, official evidence, actual runtime versions/output, checks performed, unresolved uncertainties and prioritized findings. Do not claim a check that was not run.
