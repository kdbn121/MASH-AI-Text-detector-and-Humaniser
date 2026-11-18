# Contributing

Thanks for taking the time to improve this skill. It is a small project with one
owner, so the bar for a change is that it keeps the chain honest.

## Getting set up

```bash
git clone https://github.com/kdbn121/MASH-AI-Text-detector-and-Humaniser.git
cd MASH-AI-Text-detector-and-Humaniser
```

You need Node.js 18 or newer and Python 3.9 or newer. Neither script needs a third
party package.

## Before you open a pull request

Run the three checks that CI runs:

```bash
node scripts/lint-skill.mjs
node scripts/selftest.mjs
python scripts/fetch_patterns.py --force
python scripts/pattern_lint.py examples/clean-sample.txt --no-title-page-no-refs
python scripts/pattern_lint.py examples/control-ai-sample.txt --no-title-page-no-refs
```

The first sample must come back clean with exit code 0. The second must come back
with findings and exit code 1. A lint that reports nothing on the control sample is
a broken lint.

## What a good change looks like

- **Measured.** A change to the rewriting engine needs a before and after figure
  from `audit.mjs`, not an opinion about how the prose reads.
- **Scoped.** The engine protects numbers, citations, defined terms, quotations,
  tables and figures. A change that starts moving them is a regression.
- **Honest.** The skill reports what a checker returned and reports a failure as a
  failure. A change that softens that is not welcome, however convenient.
- **Body only.** The cover page and the reference list stay out of every
  measurement.

## Style

- British English.
- No em dashes and no en dashes in prose.
- Straight quotes and straight apostrophes in plain text.
- Sentence case for headings.
- Every new script gets a self test.

## Reporting a problem

Open an issue with the bug report template. A reproduction is worth more than a
description: the command you ran, the file you ran it on and what came back.

## Licence

By contributing you agree that your contribution is licensed under the MIT Licence of
this repository, the same as the rest of it.
