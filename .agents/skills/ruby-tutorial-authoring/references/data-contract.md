# Discover and edit structured lesson data

The executable schema/types, validator, resolver and consumers own the data contract. Inspect them before editing; do not maintain a second field list or cardinality table in the skill. Current discovery entry points are `src/tutorial/schema.ts`, `src/tutorial/content.ts`, `src/tutorial/validation.ts`, `src/tutorial/data/` and `src/tutorial/references.ts`; verify their locations and responsibilities at task time. Confirm validation commands in `package.json`.

Trace a representative lesson from stored data through version resolution, rendered text, Example/Experiment selection, runtime execution, metadata and social image generation. Identify stable URL identity, chapter membership, actual ordering, learner-visible fields and author-only evidence. Read neighboring entries for conventions, but prefer the executable contract when examples disagree.

Before a variant edit, inspect how inheritance, overrides, array merging/replacement and availability actually resolve. Resolve the complete result for every affected version. Keep explanation, starter code, tasks, observed outputs and feedback mutually consistent; ensure new syntax does not leak into inheriting older versions. Absence of an override does not prove compatibility.

Use structured data for lesson meaning and code; shared components own layout, escaping and navigation. Retain observed outputs and explanatory answers for author validation without displaying results or answers to the learner. Example demonstrates the representative basic form; Experiments apply the same concept through purposeful variations. Respect current executable constraints on their shape and count.

Keep runtime labels/default rules in shared runtime configuration, chapter names/order in the course catalog and ordering resolver, and official-link resolution in its mapping. Do not introduce another list in lesson prose or skill references. When adding a field, update its executable contract, validation and affected consumers; change skill guidance only if authoring judgment, discovery or verification changes.

## Data-stage handoff

- Explain the learning outcome and placement using `learning-sequence.md`.
- Verify main claims and tasks against semantically relevant version-specific official sources, including anchors. Report evidence without inventing unrecognized data fields.
- Run exact Example and Experiment code in the affected bundled WASM runtimes; record runtime identity and observed output. Use `evaluation.md` for teaching quality as a separate check.
- Run current data validation and report the data diff, affected versions and unresolved findings. Generation must not silently supply missing teaching content.
- Protect existing identities and explicit successors when changing organization; inspect the current redirect contract. Official-documentation regrouping alone is not a reason to mark a lesson unavailable.
