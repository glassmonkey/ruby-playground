# Structured lesson data

Read `src/tutorial-content.ts` for the current TypeScript contract and resolver, and `content/tutorial-versions.json` for supported versions. This document explains field meaning; it does not replace the executable contract. If the model changes, update the type, consumers and this reference together.

`content/tutorial.json` is an ordered array. Array order defines the learning path, previous/next navigation and sidebar numbering. Each entry describes one lesson; `slug` is its stable identity across versions. Do not rename an existing slug casually: URLs and saved progress use it.

| Fields | Meaning |
| --- | --- |
| `slug`, `title`, `chapter` | URL-safe unique identity, learner-facing title and course grouping |
| `goal` | A concrete outcome the lesson enables; also used as page description |
| `paragraphs` | Ordered explanation paragraphs, stored as plain text |
| `code`, `output` | Runnable Ruby starter and its observed standard output; current fixtures omit the final newline |
| `task`, `answer` | A specific experiment and feedback explaining its result |
| `pitfall` | A likely misconception and its correction |
| `refs` | Official reference identifiers resolved by the generator; inspect its mapping and version overrides before adding an identifier |
| `versionNote` | Optional learner-relevant difference or limitation |
| `remaining` | Author-only notes; never render these as learner content |
| `variants` | Overrides keyed by supported version ID |

Variants are shallow overrides of all fields except `slug`. Arrays replace the entire field. `available: false` excludes a lesson from that version's path. A shared lesson must work on every version that inherits it. Keep the code, output, explanation and task mutually consistent after each override. Never infer support just because no override exists.

Use plain text and real newlines in code; do not store HTML, CSS, sidebar labels, completion state or rendered navigation. The renderer owns layout and escaping. Browser storage owns learner progress. The version catalog owns version labels and the internal default stable version; the UI displays concrete version numbers.

## Data-stage acceptance

- Inspect neighboring entries so prerequisites precede their use. Do not add a topic merely to increase a completeness count.
- Check official version-specific sources and record evidence in the review, without inventing unrecognized JSON fields for the report.
- Run starter code and the proposed exercise in the relevant WASM versions. Apply the teaching-quality rubric in `evaluation.md` to the goal, explanation, task and feedback together.
- Run `npm run typecheck` to check the current data/type integration. This does not validate Ruby behavior or every semantic constraint.
- Hand off the JSON diff, affected versions, actual observed output and unresolved findings. Page generation must not silently fill in missing teaching content.
