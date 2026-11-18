## What this changes

<!-- One or two sentences. What is different after this pull request? -->

## Why

<!-- The problem this solves, or the measurement that prompted it. -->

## Measurements

<!-- If the engine changed, give the before and after from audit.mjs. -->

```
before:
after:
```

## Checks run

- [ ] `node scripts/lint-skill.mjs`
- [ ] `node scripts/selftest.mjs`
- [ ] `python scripts/pattern_lint.py examples/clean-sample.txt --no-title-page-no-refs` (exit code 0)
- [ ] `python scripts/pattern_lint.py examples/control-ai-sample.txt --no-title-page-no-refs` (exit code 1)

## Scope

- [ ] The change does not move numbers, citations, defined terms, quotations, tables or figures.
- [ ] The change does not touch the cover page, the contents page or the reference list.
- [ ] No score is invented, and a checker failure is still reported as a failure.
