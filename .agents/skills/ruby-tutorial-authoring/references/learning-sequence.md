# Learning sequence

The shared catalog in `content/tutorial-chapters.json` defines the published order. Plan a lesson around something a learner can do, then identify concepts needed to understand its Example and Experiments. Existing slugs and page counts are not curriculum requirements: split overloaded lessons, add missing foundations and preserve retired URLs through explicit successor redirects.

The main course progresses through:

| Chapter                  | Learning purpose and boundaries                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running Ruby             | Execute values and expressions, display them, assign and reuse variables. Introduce comments and ordinary line breaks in context. Avoid return-value subtleties and object identity at the entry point. |
| Basic Data               | Work with numbers, strings, booleans, nil and symbols. Introduce basic operations where they are useful.                                                                                                |
| Decisions and Loops      | Compare values, branch and repeat. Explain each control construct before using it; do not depend on collection transformations or blocks yet.                                                           |
| Working with Collections | Store and retrieve values using arrays and hashes, describe intervals with ranges. Keep Enumerable transformations for later.                                                                           |
| Methods and Blocks       | Define reusable methods, pass arguments, return values and yield to blocks. Reserve stored Proc/lambda behavior for later.                                                                              |
| Using Collections        | Apply already-introduced blocks to iteration, mapping and filtering.                                                                                                                                    |
| Creating Objects         | Define classes and instance state, use inheritance and modules, then define operators when meaningful for an object.                                                                                    |
| Handling Errors          | Handle specific failures, raise exceptions and perform cleanup. This is a practical part of the main course.                                                                                            |
| Expressive Ruby          | Apply foundations to pattern matching and stored callable behavior such as Proc and lambda.                                                                                                             |

Refinements and unusual forms such as `BEGIN`/`END` belong in Supplementary Topics, after the main course. Do not treat every syntax-reference heading as an equally important course milestone.

For additions, check both directions: what earlier material this lesson assumes, and what later material it enables. An application should deepen the lesson's basic example without silently requiring a later chapter. Explain small necessary API calls locally, or move the application later. Keep this prerequisite order identical across supported versions; adapt code and factual references where behavior differs.

Reference books may inform broad progression. Do not reproduce a book's table of contents, distinctive chapter organization, explanations or examples. Author independent examples for this browser environment and use official Ruby documentation to verify syntax/API facts. Keep this authoring rationale out of learner-facing copy.
