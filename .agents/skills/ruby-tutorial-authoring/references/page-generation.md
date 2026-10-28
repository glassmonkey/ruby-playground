# Generate pages from lesson data

Inputs are `content/tutorial.json`, `src/versions.ts` and the shared page/UI implementation. Render the basic Example and named application Experiments, with results obtained only by Run. Omit progress counters and answers. `src/tutorial-content.ts` resolves version variants. `scripts/generate-tutorial.mjs` renders the resolved content, course navigation, metadata and sitemap. Generated `tutorial/` HTML is not an authoring input.

1. Check the data-stage handoff and read the generator before running it: it recreates the owned `tutorial/` directory. Preserve unrelated user changes. If there is a factual or teaching defect, return to the JSON authoring stage instead of patching HTML.
2. Run `npm run tutorial:generate`. Review the generated diff for intended routes, navigation, references and canonical URLs. A second run with identical inputs should produce no further changes.
3. Run `npm run build` for type checking and production bundling. For a new or changed lesson, run its focused cases in `e2e/seo.spec.ts`; the existing loop discovers lessons from the data. Choose a free `PORT`. Repeat against `E2E_DEV_SERVER=1` when routing or dev integration changes. Do not run suites concurrently against the same output directory.
4. Open the actual preview route in a browser. Confirm content, selected version and runtime agree; execute the starter and task. Check nearby lesson navigation and full Playground handoff. For layout changes, inspect desktop/mobile and both themes; for version changes, inspect affected variants. Do not report a built test server as proof that the user's preview URL works.
5. Commit source inputs with derived HTML, CSS and sitemap when publication is authorized. Report the preview, checks and limitations separately from content-quality findings.

The common renderer owns header version/theme controls, sidebar/current position, explanation/editor layout, references and previous/next links. A content-only change should not fork these per lesson. It must not expose author-only coverage notes or add an AI-written narrative at generation time.

Repository commands are the execution path; this skill coordinates them. Page generation is deterministic rendering, not a second LLM content-generation step. SEO JSON-LD, if introduced separately, must also derive from the same source and describe only content visible on the page.
