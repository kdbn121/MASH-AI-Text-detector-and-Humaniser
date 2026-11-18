---
name: mash-ai-text-diector-and-humaniser
description: |
  One skill that runs the whole academic writing audit chain in a fixed order: the
  academic editor stage, the live AI pattern check against the current Wikipedia
  signs of AI writing page, the humaniser stage that removes the named AI patterns
  and the tone that gives them away, the similarity audit that measures and reduces
  matched wording in the user's own prose, and the final proof run that shows the
  difference. Use when the user says "run the audit chain", "check this for AI
  writing and similarity", "humanise this and prove it", "is this flagged as AI",
  "reduce the similarity in my own draft", "check for AI tells", "cross check live
  against the Wikipedia list", "audit my academic writing", or hands over a .docx,
  .txt or .md file to be checked, rewritten and measured. It is for the user's own
  academic prose. It never disguises work the user did not author.
---

# MASH AI Text Diector and Humaniser

Five stages, one order, one proof. The order matters, because each stage measures
what the stage before it produced.

```
  academic-editor  ->  live pattern check  ->  humaniser  ->  similarity audit  ->  proof run
   argument,          live Wikipedia        tone, the 24   matched wording in    both measures
   structure,         pattern list, live    named          the user's own       again, over the
   references,        checkers, body only   patterns,      prose, body only     same scope
   figures                                   rhythm
```

Every stage works on the body only. The cover page, also called the title page, the
contents page and the reference list are excluded from every measurement and from
every rewrite.

## The five stages

### Stage 1, academic editor

Argument, structure, figures and references. Answer reviewers point by point. This
stage reads the brief and the rubric and tightens the argument before any style work
starts, because a sentence rewritten into a better shape is wasted work if the
argument behind it was wrong.

Working file: `agents/academic-editor.md`. The agent definition is what the mash-mighty
chain runs for this stage.

### Stage 2, the live pattern check

The pattern list is never read from a stored copy. It is fetched from the live
Wikipedia page on every run, because that page is edited by anyone at any time and a
snapshot goes stale.

```
python scripts/fetch_patterns.py --force
python scripts/pattern_lint.py "<file>" --no-title-page-no-refs
python scripts/live_checkers.py "<file>" --out-dir "<dir>"
```

The fetch pulls the raw wikitext of
`https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing`, parses the pattern
sections and the watch word lists, and caches them for 24 hours. The lint checks the
document against that live list, plus the local rule sets and the typography rules,
and exits 1 when it finds anything and 2 when it had nothing to lint. The checker
script extracts the body, writes paste ready chunks, attempts the live checker
endpoints that need no account, and writes a `.live-check.json` record.

The old flag names `--exclude-front` and `--no-front-no-refs` still work as aliases.
They mean the cover page.

### Stage 3, the humaniser

Tone, register, rhythm, and the named AI patterns: inflated significance, notability
claims, participial padding, promotional language, vague attribution, formulaic
outlook sections, AI vocabulary, copula avoidance, negative parallelisms, forced
groups of three, synonym cycling, false ranges, em dash overuse, bold overuse,
inline header lists, title case headings, emoji, curly quotes, chat artefacts,
knowledge cutoff disclaimers, sycophancy, filler phrases, stacked hedging and generic
conclusions.

The catalogue in `references/ai-text-humanizer-catalogue.md` is the working set. The
live list from stage 2 overrides it wherever the two differ. The rules the lint
enforces are written out in full in `rules/writing-rules.md`, and the pattern
catalogue with the fix for each one is in `rules/humanizer-rules.md`.

### Stage 4, the similarity audit

Measure the matched wording against the source, then rewrite the user's own prose so
it is genuinely their wording rather than a synonym swap of somebody else's.

```
node scripts/audit.mjs "<target>" --source "<source>"
node scripts/transform.mjs "<target>" --out "<rewritten>" --source "<source>" --intensity standard
node scripts/rewrite-docx.mjs "<target>" --out "<rewritten>" --plan "<plan.json>"
```

The audit reports the matched chains, the invisible Unicode, the sentence length
variation, the lexical diversity, the discourse marker repetition and the trigger
phrases. The transform engine runs sixteen stages over the prose and leaves numbers,
citations, defined terms, quotations, tables and figures alone. The rewrite script
applies the plan to the document and also applies the six document formatting rules.

The full procedure, with every option and every guard, is in
`references/plagiarism-minimiser-procedure.md`.

### Stage 5, the proof run

Run the live check and the local audit again on the result, over the same scope.
Report the before and the after as numbers.

A rewrite with no baseline is a guess, and the user cannot tell whether the
intervention helped or only made the prose worse.

## The order, and why

1. The editor stage first, so the argument is right before the words are tuned.
2. The live check before the rewrite, so the baseline is measured against the pattern
   list as it stands today rather than as it stood when the skill was written.
3. The humaniser before the similarity audit, because the audit only rewrites
   matched wording, and it should not be asked to fix a sentence that is about to
   change anyway.
4. The similarity audit before the proof run, so the proof measures the final text.
5. The proof run last, over the same body, so the two numbers are comparable.

## Scope and honesty

- Every measurement is over the body. The cover page, the contents page and the
  reference list are excluded, because a reference list quoted in full is always a
  perfect match and a cover page carries no prose.
- A checker that cannot be reached is reported as a failure, with the reason and the
  manual command. No score is invented, and no score is guaranteed. The detector
  thresholds are private and move without notice.
- The local similarity figure is an estimate against the source the user gives. It is
  not a Turnitin score and it does not predict one.
- Quotations are never rewritten. Rewriting a quotation turns it into an unattributed
  paraphrase, which is worse than the problem it solves.
- References, numbers, equations and citations are never changed.
- A clean result means the known patterns are absent. It is not a certificate of
  authorship.
- If the user asks for text they did not write to be presented as their own, say so
  plainly and offer the legitimate route instead: quote with attribution, or
  paraphrase and name the source.

## Commands

```powershell
# live pattern source
python scripts/fetch_patterns.py --force

# lint the body only
python scripts/pattern_lint.py "<file>" --no-title-page-no-refs
python scripts/pattern_lint.py "<file>" --no-title-page-no-refs --out "<report.txt>"

# prepare and attempt the live checkers
python scripts/live_checkers.py "<file>" --out-dir "<dir>"
python scripts/live_checkers.py --list

# similarity
node scripts/audit.mjs "<file>" --source "<source>"
node scripts/detector-pressure.mjs "<file>" --json
node scripts/transform.mjs "<file>" --out "<out>" --source "<source>" --intensity standard
node scripts/rewrite-docx.mjs "<file>" --out "<out>" --plan "<plan.json>"

# citations
node scripts/audit-citations.mjs "<file>" --style harvard
node scripts/format-citations.mjs "<file>" --style harvard --out "<out>"

# formatting
node scripts/justify-docx.mjs "<file>" --out "<out>"
node scripts/format-docx.mjs "<file>" --out "<out>"

# hygiene
node scripts/purge.mjs "<file>" --out "<out>"
node scripts/lint-skill.mjs
node scripts/selftest.mjs
```

The engine scripts are Node.js with no third party dependencies. The live pattern
scripts are Python 3 with no third party packages. Use `node` and `python`, never
`nodejs` and never `python3`.

## What is in this repository

| Path | What it is |
| --- | --- |
| `scripts/` | The similarity engine, the citation tools, the formatting tools and the live pattern scripts |
| `rules/` | The word banks the engine reads, plus the writing rules and the humaniser catalogue |
| `references/` | The full procedures, the detection mechanics, the format protection rules and the live checker routes |
| `agents/academic-editor.md` | The academic editor stage of the chain |
| `examples/` | A sample source, a plan file and the control sample used by the self test |
| `docs/images/` | The photo card, the social preview and the chain diagram |

## Licence

MIT. Copyright (c) 2026 KDBN (Khaled Bhuiyan).
