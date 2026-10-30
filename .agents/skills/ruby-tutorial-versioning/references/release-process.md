# Runtime and course release process

## Discover runtime and publication policy

Find the shared runtime registry, runtime loader/dependency mapping, default-selection rule and tutorial resolver. Current entry points include `src/versions.ts`, `src/workers/ruby-worker.ts` and `src/tutorial/content.ts`; confirm these against the working tree. Implementation owns the supported list and selection rules. Do not maintain a tutorial-only registry or copy another project's default policy.

Treat runtime registration, course readiness and default selection as separate decisions. Before registration, trace whether adding an entry automatically publishes inherited lessons, routes, sitemap entries and social images or changes the default. Explain that impact before making the entry selectable. Preserve the existing default policy unless changing it is explicitly in scope.

For a release review:

1. Verify the bundled WASM dependency and loader coverage. Execute it and record concrete runtime identity; package/minor labels alone do not prove the bundled release.
2. Audit every inherited lesson's claims, Example, Experiments, expected outputs, references and required standard libraries in the real environment. Determine needed overrides or unavailability from evidence; generation success is not compatibility evidence.
3. Read actual inheritance/override/availability behavior before editing. Verify older versions after shared changes. Keep shared learning order and stable identities; a documentation move is not lost runtime support.
4. Check that registry, selectors, course entry/default and runtime handoff agree. Preserve fixed URLs and alias query/fragment behavior. Verify generated metadata and images match the resolved lesson and clearly expose development or other material release status.

Keep runtime evidence, readiness gaps and default/publication consequences distinct in the report. Do not claim a new course ready solely because the registry accepts its entry or the build emits pages.
