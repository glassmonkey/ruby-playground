# Chapter placement and learning sequence

Discover the current chapter catalog, lesson associations and actual ordering resolver in the implementation. Inspect rendered navigation as well as source order: they need not be identical. Do not duplicate the current table of contents here.

Keep four independent axes clear: learning classification groups outcomes; learning order follows prerequisites; official references substantiate claims; version/runtime availability determines where a lesson works. One manual chapter may support several lessons, and one lesson may cite several manual categories. A reference move does not require a curriculum move.

Before placement, state what the learner can do or predict afterward, what knowledge the Example and Experiments require, and what later practice they enable. Check both earlier and later lessons, including small API calls that an application silently assumes.

| Decision | Evidence required |
| --- | --- |
| Extend an existing chapter | Its learning goal, prerequisite stage and surrounding progression fit the new outcome. Similar names alone are insufficient. |
| Add a chapter | Existing placement would obscure a chapter's purpose or require a prerequisite leap. State the new goal, included/excluded scope, required prior lessons and relation to the next stage. |
| Split or merge | Goals or prerequisite levels are mixed, purposes overlap, or explanations repeat. Judge cohesion rather than a target chapter/lesson count. |
| Defer | A meaningful goal, prerequisite material, runnable environment or verification method is missing. Report the missing condition; do not hide the topic in a catch-all chapter. |

Optional material still needs a specific purpose and boundary. Do not create “Other” or “Supplementary” chapters merely as containers for unclassified topics. Adding a runtime alone is not grounds for a new chapter: first consider whether the same learning outcome can use a version-specific explanation or example.

Use one learning order and stable lesson identities across versions. Adapt content and availability where necessary. For a move, split or merge, check prerequisite reachability, actual navigation order, version availability and existing URL/successor behavior. A skill-maintenance request does not itself authorize reorganizing published lessons.

For source use and independent examples, follow [the shared source standards](../../ruby-tutorial-authoring/references/sources.md).
