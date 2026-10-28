# Independent learning review

No blockers found in the source-data review. Two improvements follow. This is not a runtime or rendered-page pass.

## Scope and evidence

Read the updated repository `.agents/skills/ruby-tutorial-authoring/SKILL.md`, `references/learning-sequence.md` and `references/evaluation.md`; inspected final `content/tutorial.json` from `conditionals` through `special-forms` (17 lessons), the chapter catalog, version catalog, resolver and generator reference mapping. Did not review the six introductory lessons I authored. No content was modified, server started, or generation performed.

The final sequence implements the skill's prerequisite boundaries: decisions and loops do not require blocks; arrays/hashes/ranges precede methods and blocks; `enumerable` follows blocks; classes, inheritance and mixins precede operator definitions; exceptions precede the rescued lambda-arity experiment; refinements and special forms are supplementary. Experiments are independent runnable snippets. Examples show representative basic forms, while most experiments apply a concept to new conditions or a richer use. Expected output and explanatory answers remain in author-only fields.

## Findings

1. **Improvement — `conditionals`, all versions, experiment `boundary`, task.** The task states that a parcel is accepted "only below the weight limit" and then asks the learner to "decide whether < should become <=" at the limit. The stated requirement already excludes equality. This weakens the connection between a requirement and its implementation: changing to <= would violate the given rule. **Action:** ask the learner to predict rejection at equality, then explicitly introduce a changed rule that also accepts the limit before requesting <=.

2. **Improvement — `classes`, all versions, experiment `experiment-2`, task/code.** "Choose a starting value" repeats the Example's Counter class, changes the constructor argument and calls increment twice. The Example already creates counters with default and explicit initial values, and the first experiment already varies the receiver and number of calls. The second experiment adds little distinct application. **Action:** keep the independent snippet but ask the learner to add a `reset` method that restores the initial value (store `@start` during initialization), then compare two counters after resetting one. This exercises defining behavior and independent instance state without new prerequisites.

## Official-source checks

The reviewed claims agree with the consulted Ruby 3.2 primary documentation:

- [Control expressions](https://docs.ruby-lang.org/en/3.2/syntax/control_expressions_rdoc.html): truthiness, ordered branch selection, loop control.
- [Method definitions](https://docs.ruby-lang.org/en/3.2/syntax/methods_rdoc.html): method arguments, returned expressions, operator methods.
- [Modules and classes](https://docs.ruby-lang.org/en/3.2/syntax/modules_and_classes_rdoc.html): mixins, class behavior and inheritance.
- [Proc](https://docs.ruby-lang.org/en/3.2/Proc.html): closures, lambda/non-lambda argument and return behavior.
- [Pattern matching](https://docs.ruby-lang.org/en/3.2/syntax/pattern_matching_rdoc.html): structural binding, unmatched case/in error, additional-key behavior and guards.

No version overrides exist in these 17 entries; all five courses inherit the same data. This review did not independently verify every cited API in all five versioned manuals. The earlier literal-source checks cover 3.2, 3.3, 3.4, 4.0 and master, but do not establish all later-lesson APIs.

## Unverified checks

No WASM executions, actual RUBY_VERSION values, observed outputs, routes, browser interactions, selector persistence, Playground handoff, or themes were checked in this review; the parent is performing E2E checks. In particular, the browser-specific END/Worker lifecycle explanation in `special-forms` requires the parent's runtime/implementation evidence. The authored output intentionally omits END output; source inspection alone does not prove that lifecycle behavior.

Priority: clarify the boundary task first; improve the second class experiment next. Neither finding demonstrates a runtime or factual failure.

# Follow-up review of three changed entries

Both earlier improvement findings are resolved. No new blocker or material teaching improvement found in this scoped recheck.

- `conditionals/boundary`: the task now explicitly changes the rule to accept equality before requesting the comparison edit. Its requirement, code exploration and answer align.
- `classes/experiment-2`: the new reset experiment stores `@start` during initialization and restores `@value` from it. This is a distinct application of persistent instance state and method behavior. The task asks whether reset uses the object's initial value or zero, and the answer explains that distinction. No later-course concept is required.
- `enumerable/combine`: filtering followed by mapping provides a purposeful application of the two earlier experiments. The basic Example remains each with a named block parameter. The new paragraph explains chaining, separate blocks and implicit it locally; its placement after the blocks lesson agrees with `learning-sequence.md`.

Resolved enumerable data separately for 3.2, 3.3, 3.4, 4.0 and 4.1 using the resolver's shallow-override behavior. Both older variants replace the complete four-paragraph and three-experiment arrays, use explicit `|count|` in each block, and override the version note. Newer versions inherit the implicit-it form. The three experiment IDs, task/answer intent and authored output stay aligned across versions. This supersedes the earlier report's statement that none of the reviewed entries has variants.

[Official Ruby 3.4 NEWS](https://docs.ruby-lang.org/en/3.4/NEWS_md.html) explicitly records introduction of it. [Calling Methods](https://docs.ruby-lang.org/en/3.4/syntax/calling_methods_rdoc.html) supports chained method calls and brace blocks; its current text does not itself document the it rule. The linked [official feature discussion #18980](https://bugs.ruby-lang.org/issues/18980) supplies the additional context for that feature. Calling-method references for [4.0](https://docs.ruby-lang.org/en/4.0/syntax/calling_methods_rdoc.html) and [4.1 development](https://docs.ruby-lang.org/en/master/syntax/calling_methods_rdoc.html) were also opened. The release introduction is supported by NEWS rather than inferred from those reference pages.

Only source-data, source references and prerequisite/experiment alignment were rechecked. No repository file was edited. Runtime and rendered-page checks remain with the parent; the expected reset and chaining outputs were not claimed as observed WASM output.
