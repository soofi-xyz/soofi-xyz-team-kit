---
name: frontend-bug-fix
description: Repository-specific frontend bug triage and fix workflow with design comparison, commit analysis, test updates, and verification.

---
This skill helps frontend designers and engineers find, diagnose, and fix UI bugs in the repositories by comparing the product to source designs, auditing overrides in commit history, and strengthening tests to prevent regressions.
## When to Use
- A frontend UI bug is reported or discovered.
- A design mismatch is suspected (layout, content, styling, interactions).
- You need to confirm if a change was overridden or regressed.
## Inputs You Must Collect
- **Bug description**: what is wrong, expected vs actual.
- **Location**: page/route/component(s) involved.
- **Design source**: Figma link or design asset reference.
- **Repro steps**: exact steps or conditions.
If the design source is missing or outdated, ask the user for a **new Figma link** before proceeding.
## Workflow
1. **Find the design reference**
   - Check the design folders:
     - `@apps/landing_page/test/design`
     - `@apps/payment_portal/test/design`
   - Identify the exact screen/component the bug references.
   - Note any mismatch between the design artifact and current UI.
2. **Confirm the UI mismatch**
   - Identify the file(s) responsible for the UI.
   - Compare current markup/styles with the design reference.
   - Document the specific deltas (spacing, typography, copy, layout, behavior).
3. **Analyze commit and override history**
   - Inspect recent commits and PRs touching the related files.
   - Look for any of these override signals:
     - Reverted changes in subsequent commits
     - Duplicate edits of the same block
     - Last-minute style overrides
     - Conflicting changes across branches
   - If you find an override, identify the exact commit that introduced it.
4. **Ask for updated design if needed**
   - If the design reference looks stale or conflicting, stop and ask the user for a **new Figma link**.
5. **Assess tests that should have caught it**
   - Identify any unit/E2E/spec tests that cover the affected area.
   - If coverage exists but missed the issue, determine why:
     - Missing assertion?
     - Too loose selector?
     - Snapshot not precise enough?
   - If coverage does not exist, design a minimal test to prevent regression.
6. **Fix the bug**
   - Apply the smallest change that aligns the UI with the design reference.
   - If the bug came from an override, restore the intended behavior by reapplying the correct change from earlier commits.
7. **Update or add tests**
   - Use `skills/responsive-design-tests/SKILL.md` for any new or updated design tests.
   - Strengthen tests that should have caught the bug.
   - Keep tests focused and stable (avoid brittle selectors).
8. **Verify**
   - Run relevant tests and confirm they pass.
   - Confirm the UI now matches the design reference.
## Output Expectations
- Clear summary of the root cause.
- The file(s) changed and why.
- Any override/commit that caused the regression.
- Updated or added test coverage.
- Test run results.
## Quality Bar
- Match design spec precisely.
- Minimal changes, no unrelated refactors.
- Tests are specific and meaningful.
- No regressions introduced.