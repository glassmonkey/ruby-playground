# Structured lesson data

Read `content/tutorial-chapters.json` for the shared tutorial chapter catalog and `src/tutorial-content.ts` for the current TypeScript contract and resolver, and `content/tutorial-versions.json` for supported versions. This document explains field meaning; it does not replace the executable contract. If the model changes, update the type, consumers and this reference together.

`content/tutorial.json` is an ordered array. `content/tutorial-chapters.json` defines a single chapter order shared by every version, using a learner-first sequence rather than reference-manual headings; array order defines lesson order within a chapter. The resolver produces previous/next navigation and sidebar numbering from that order. Each entry describes one lesson; `slug` is its stable identity across versions. Do not rename an existing slug casually: URLs use it.

| Fields | Meaning |
| --- | --- |
| `slug`, `title`, `chapter` | URL-safe unique identity, learner-facing title and course grouping |
| `goal` | A concrete outcome the lesson enables; also used as page description |
| `paragraphs` | Ordered explanation paragraphs, stored as plain text |
| `code`, `output` | Runnable Ruby starter and its observed standard output; current fixtures omit the final newline |
| `experiments` | Two or three independent experiments, each with stable `id`, short `title`, `task`, runnable `code`, observed `output`, and explanatory `answer` |
| `pitfall` | A likely misconception and its correction |
| `refs` | Official reference identifiers resolved by the generator; inspect its mapping and version overrides before adding an identifier |
| `versionNote` | Optional learner-relevant difference or limitation |
| `remaining` | Author-only notes; never render these as learner content |
| `variants` | Overrides keyed by supported version ID |

Variants are shallow overrides of content fields, excluding stable `slug` and `chapter`. Arrays replace the entire field. `available: false` excludes a lesson from that version's path. A shared lesson must work on every version that inherits it. Override the entire experiments array when a variant changes supported syntax; a newer shared experiment must not leak into an older version. Keep starter code/output and each experiment’s task/code/output/answer mutually consistent after each override. Never infer support just because no override exists.

Use plain text and real newlines in code; do not store HTML, CSS, sidebar labels, completion state or rendered navigation. The renderer owns layout and escaping. The version catalog owns version labels and the internal default stable version; the UI displays concrete version numbers.

## Data-stage acceptance

- Inspect neighboring entries so prerequisites precede their use. Do not add a topic merely to increase a completeness count.
- Check official version-specific sources and record evidence in the review, without inventing unrecognized JSON fields for the report.
- Run starter code and the proposed exercise in the relevant WASM versions. Apply the teaching-quality rubric in `evaluation.md` to the goal, explanation, task and feedback together.
- Run `npm run typecheck` to check the current data/type integration. This does not validate Ruby behavior or every semantic constraint.
- Hand off the JSON diff, affected versions, actual observed output and unresolved findings. Page generation must not silently fill in missing teaching content.

The UI selects Example and named Experiments as parallel states, with choice buttons beside the relevant explanation. Example is the basic form; experiments are applications of that same concept. Each sample keeps its own draft during page navigation within the selector; selection never runs code. There is no apply/undo/reset workflow. Expected outputs and answers are author-side verification data, not rendered disclosures. There is no learner progress management. Choose distinct experiments that demonstrate the lesson’s goal rather than three arbitrary parameter tweaks.

References must directly support the main learning goal and task, not merely a side remark. For output, link to Kernel#puts and Kernel#p, not just Code Layout. Verify anchors as well as HTTP status and version.

Use the shared tutorial chapter names and ordering. Official Syntax documentation informs content; it is not a compliance claim or a requirement to mirror each version’s table of contents. Do not add a “4.0-based” or “latest-based” label. The course includes appropriate core APIs in its learning progression; it is not restricted to reproducing the syntax reference. `content/tutorial-supplements.json` archives retired material; `redirectTo` names its active successor. Optional published lessons remain in `tutorial.json` under Supplementary Topics. Keep the chapter and lesson identity fixed even if older official documentation groups the topic differently; adapt its reference URL instead. Do not use available:false merely because a reference chapter moved.
