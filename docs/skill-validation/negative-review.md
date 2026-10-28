# Independent review: `output` and `blocks`

## Conclusion

**Two blockers found:** `output` lists the wrong result for its starter code, and the Ruby 3.3 `blocks` page fails when run. The fresh browser evidence and remaining limits are recorded below. I did not change lesson inputs.

## Findings

### Blocker — `output`, all inherited versions, expected output

- **Evidence:** `content/tutorial.json` has starter code `p 2 + 3`, expected output line `6`, and task “Change 2 + 3 to 2 * 3.” Integer addition evaluates to 5, so the starter prints `5`; multiplication evaluates to 6, so the exercise changes that line to `6`. The generated Ruby 4.0 page (`tutorial/4.0/output/index.html`) also displays `6` as the original example's expected output. The answer says the number “becomes 6,” which is true only after doing the task, and makes the mismatch easy to miss.
- **Consequence:** learners who run the untouched starter see `5` while the page promises `6`, undermining the first lesson's explanation of output.
- **Action:** change the expected starter output and answer to distinguish the initial `5` from the edited `6`.

## Teaching-quality notes

- `blocks` has a narrow stated goal but mentions Proc/lambda arity and `return` differences without demonstrating either. This is an improvement opportunity: move those claims to a later lesson or add a focused experiment. Its task tests yielding but not Proc/lambda calls.
- `blocks` introduces Proc/lambda arity and `return` differences in prose without demonstrating either. This is an improvement opportunity: move those claims to a later lesson or add a focused experiment. Its stated goal includes both yielding and calling callable objects, and the starter does demonstrate both, though the single task only tests yielding.
- The trial's `docs/tutorial-skill-evaluation.md` describes `output` as having been corrected and says its expected output was runtime-confirmed. The current structured data and generated page contradict that account for the starter's arithmetic line.

## Checks and limits

- Read the skill, its evaluation rubric, the version catalog, both lesson records/variants, and the generated Ruby 4.0 output page.
- The initial Vite start was blocked by default sandbox permissions. After escalation, Vite and the existing Playwright suite ran; see the browser evidence update below.
- A separate task-focused Playwright probe timed out while looking for a runtime panel that is not part of the tutorial page. I have not verified the task edits manually. No test or lesson source files were changed by the review.
- No official version-sensitive claim was independently checked; the arithmetic defect does not depend on Ruby version.

## Completed browser evidence update

After requesting local listener approval, the Vite preview started successfully on `127.0.0.1:18931`. I ran `E2E_DEV_SERVER=1 PORT=18931 npx playwright test e2e/seo.spec.ts` against it: **76 passed, 6 failed**. All six failures directly concern the reviewed lessons:

- `output` fails in Ruby 4.0, 3.4, 3.3, 3.2 and 4.1. The browser ran the on-page code and returned `Hello, Ruby!\n5\nOne more line\nnil\n`; the generated expected output says `6` on line 2. This verifies the arithmetic defect in all five bundled course versions.
- `blocks` passes for Ruby 4.0, 3.4, 3.2 and 4.1; Ruby 3.3 fails with page status `Error` rather than `Complete`. Its 3.3 code variant still contains `p [1, 2, 3].map { it * 2 }` while the same variant's prose says to use explicit `|number|` and says implicit `it` is unavailable in 3.3. The code needs the explicit-parameter version. This is a **second blocker**: the promised lesson example does not run on its selected course runtime.
- The suite also passed course alias/version navigation, the inline playground's experiment and versioned handoff, theme synchronization across lesson/version/Playground, and progress/mobile navigation checks. These pass for the reviewed page context; no separate manual check of theme persistence with edited tutorial code was made.

I attempted a further temporary task-focused browser probe to capture runtime panel labels and exercise edits across versions. It timed out before the first capture because the tutorial page has no region named “Ruby runtime environment” (that label belongs to the main Playground); thus it produced no additional task-output evidence. I did not claim a successful task-edit check. The repository test suite itself verifies starter executions and failed as described. The tested actual version is established by each versioned route and the suite's own version loop; this run's failure output gives the exact output line. The temporary probe file `e2e/reviewer-temp.spec.ts` remains in the isolated trial repo and is not a lesson input.

No official source check was needed to establish these two defects: one is ordinary integer arithmetic, and the other is directly demonstrated by the code/prose contradiction plus an observed runtime failure. The content evaluation report's claim that `blocks` starter examples succeeded on all versions is not supported by this fresh run because Ruby 3.3 fails.
