---
name: plagiarism-minimiser-kdbn
description: |
  Check and improve academic work the user has written themselves. Reports exactly
  which passages of their draft match a source, then helps them rewrite their own
  prose so it is properly worded, genuinely paraphrased and correctly attributed,
  while leaving quotations, citations, numbers and reference lists untouched. Use
  this skill when the user says "my Turnitin report flagged a passage", "reduce the
  similarity in my own draft", "check this assignment for accidental matching", "how
  much of this is word for word from the source", "is my paraphrasing close
  paraphrase", "improve the wording of my own paragraph", "audit my draft for
  similarity", "降低查重率", "论文查重", "查重报告", or hands over a .docx, .tex or .md
  draft to be checked against a similarity report or a source they cited. It is also
  for improving the writing quality of the user's own prose: flat sentence rhythm,
  repeated connectives and repetitive phrasing. Do not use it to disguise work the
  user did not author, to rewrite quoted material, or to present someone else's
  argument as the user's own. For generic tone polish with no similarity or wording
  concern, use ai-text-humanizer instead.
---

# Plagiarism Minimiser

A writing and proofreading skill for academic work the user has written themselves. It
finds the passages in their draft that match a source, helps them rewrite those
passages in their own words, and proves what changed with a local measurement instead
of a guess.

## Purpose and scope

**What this is for.** Students and researchers routinely pick up a high similarity score
for reasons that have nothing to do with misconduct. Phrasing carried over from a
reading list, a stock literature review paragraph, a section written for a different
assignment, or a method description that has a standard wording. None of that is
plagiarism, and all of it can be fixed by writing the passage properly.

This skill is for:

- checking a draft you wrote and finding the passages that still read like somebody
  else's text
- rewriting those passages so they are genuinely your own wording rather than a
  synonym-swapped copy
- verifying that your paraphrasing is a real paraphrase and not close paraphrase
- confirming that quotations stay quoted, citations stay attached to the right claims,
  and your reference list is intact
- improving writing quality: flat sentence rhythm, over-used connectives, repetitive
  phrasing and machine-sounding constructions

**What this is not for.** It does not make someone else's work acceptable. A similarity
score is not a judgement of authorship, and lowering one does not change whose argument
it is. If a user asks for text they did not write to be presented as their own, say so
plainly and offer the legitimate route instead: quote with attribution, or paraphrase
and name the source. Quoted material is never rewritten, because rewriting a quotation
turns it into an unattributed paraphrase, which is worse than the original problem.

**Where the line sits.** The tool reports, rewrites and verifies. It never fabricates a
source, never edits a reference list, and never changes a number, a statistic or a
citation.

## Scope and honesty

- This is for the user's own writing, their own argument, and boilerplate phrasing they
  are entitled to reword. It is also for checking a draft before submission.
- It does not make someone else's work acceptable. Passing a similarity check does not
  change whose argument it is. If the user asks for text to be disguised as their own
  when it is not, say so plainly and offer the legitimate alternative: quote with
  citation, or paraphrase with the source still named.
- **No score can be guaranteed.** Turnitin does not publish its exact configuration,
  AI detectors change without notice, and a corpus shift can move a percentage on its
  own. State this in plain words whenever the user asks for a guaranteed result. What
  this skill does give is a defensible method and a measurement.
- No detection score, and no zero similarity percentage, can be promised. Say that
  plainly rather than implying the audit result is a guarantee.
- **One source is not the whole corpus.** The audit measures matched chains against
  the single source file it is given. A commercial similarity service compares
  against a multi-billion-page corpus, so it can report a high percentage on a
  document that shows zero matched chains against the one source supplied here.
  The two numbers are not comparable. When a user compares the audit result with
  a commercial score, explain this difference rather than treating either number
  as the truth.
- **A missing reference is never filled in from memory.** A citation with no entry
  in the reference list is reported as missing and left exactly as it is. A DOI
  that was not read out of the document is never written into it. A machine that
  invents a DOI writes a claim about the literature that looks right, is wrong,
  and cannot be checked by the reader who trusts it. The network check exists,
  but it is opt-in and it only ever reports what the network answered.
- **Never put warning markup inside the manuscript.** A red tag in the body of
  a paper can survive into the submitted file. Findings belong in a report
  beside the document, not in the document.

## The citation style

Ask which style the journal wants, and wait for the answer. There is no
default, because a default would be a guess about the journal and a guess
about a citation style is a guess about the paper.

The style bank is `rules/citation_styles.json` and it holds seventeen styles:
APA 7th, MLA 9th, Harvard, IEEE, Chicago 17th, Vancouver, AMA 11th, Turabian
9th, MHRA 4th, OSCOLA 4th, The Bluebook 21st, ASA 7th, AAA, APSA, ACS, CSE 8th
and the journal form of each. Each one says how many authors are named before
the abbreviation is used, whether the abbreviation is italic, whether a comma
stands between the name and the year, how many authors the reference list
lists before the abbreviation, and how the reference list is ordered.

```
node scripts/audit-citations.mjs "paper.docx" --style harvard
node scripts/format-citations.mjs "paper.docx" --out "paper-styled.docx" --style ieee
```

The audit reads every in-text citation and every entry of the reference list,
matches one against the other, checks every DOI and every link against the
shape they have to have, and checks the result against the rules of the named
style. The formatter applies the rules it can apply without inventing
anything: the italic state of the abbreviation, and the comma before the year.
It does not renumber a numeric reference list, because renumbering means
changing the numbers in the body as well and a mistake there is a mistake in
the meaning. It reports the order instead and leaves it to the writer.

## Inputs to collect

- **Target file(s) and format**: `.docx`, `.tex`, `.md`, `.txt`. Anything else gets
  converted first.
- **Source text for the comparison** (optional but high value): the passage the
  similarity report flagged, or the original document being paraphrased. Without it the
  audit can only measure style signals, not residual matched chains.
- **Authorship**: whether this is the user's own draft. It changes what is acceptable.
- **Discipline and citation style**: determines the protected-term list and the hedging
  register that sound native in that field. The citation style is a question to
  ask, not a default to assume: `audit-citations.mjs` and `format-citations.mjs`
  both refuse to run until a style is named.
- **Output destination**: rewrite in place, or write a new file. Never silently
  overwrite the user's original; write to a new file by default.

## Procedure

1. **Measure before rewriting.**
   Run the audit so you know the starting risk and can prove the change worked:
   ```
   node scripts/audit.mjs "<target>" --source "<source>"
   ```
   Reason: a transformation with no baseline is a guess, and the user cannot tell
   whether the intervention helped or just made the prose worse.

   When the user's worry is an AI detector rather than a similarity report, run
   the pressure analyser as well:
   ```
   node scripts/detector-pressure.mjs "<target>" --json
   ```
   It measures the four signal families the vendors publish, namely perplexity,
   burstiness, transition smoothness and vocabulary distribution, and it reads
   only the prose: tables, headings and code listings are left out, because a
   detector handed a listing reads the rhythm of the listing.
   Reason: this is a proxy and not a score. The classifier and its threshold are
   private and change without notice, and no vendor will say what their number
   will be. What the proxy gives is a direction and a size, measured the same
   way every time, so that a rewrite can be shown to have moved the document
   towards or away from the pattern those classifiers are built on.

2. **Cross-check live against the pattern list and the live checkers.**
   ```
   python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\fetch_patterns.py" --force
   python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\pattern_lint.py" "<target>" --no-title-page-no-refs
   python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\live_checkers.py" "<target>" --out-dir "<dir>"
   ```
   Reason: the local audit measures similarity against the source the user gives.
   The live check reads the current pattern list from Wikipedia and asks the live
   checkers, so both measurements describe the same state of the same text. The
   comparison is over the body only, with the cover page, also called the title page,
   and the reference list excluded, which is the treatment used here and in the audit.
   A checker that does not answer is reported as a failure, and no score is invented.

3. **Freeze what must not move.**
   Build the protected list before touching prose: numbers, units, dates, statistical
   values, equations, code, citations and their keys, defined terms, proper nouns, direct
   quotations, table and figure content, and any sentence the user marked.
   See `references/format-protection.md`.
   Reason: these are the parts that make the document correct and attributable. A
   similarity score is never worth a broken equation or a misquoted source.

4. **Run the deterministic engine, then the transformation ladder.**
   The engine does the mechanical work in one pass, so the ladder is only needed
   for what the engine could not reach:
   ```
   node scripts/transform.mjs "<target>" --out "<rewritten>" --source "<source>" \
     --intensity standard --plan "<plan.json>"
   ```
   For a `.docx` the engine writes a plan file and leaves the document alone.
   Apply it with the rewrite script:
   ```
   node scripts/rewrite-docx.mjs "<target>" --out "<rewritten>" --plan "<plan.json>"
   ```
   For a text, `.md` or `.tex` file the engine writes the rewritten file directly
   and `--plan` is not needed.

   The rewrite script also justifies the document as it writes it, so every body
   paragraph reaches both margins whatever the original alignment was. Table
   cells and headings are left as they are, because a centred title stays
   centred in a paper that is otherwise justified. Pass `--no-justify` to keep
   the original alignment. To justify a document without rewriting it, use the
   standalone script:
   ```
   node scripts/justify-docx.mjs "<target>" --out "<justified>"
   ```

   The rewrite script also applies the six document formatting rules, unless
   `--no-format` is given. To apply them to a document without rewriting it:
   ```
   node scripts/format-docx.mjs "<target>" --out "<formatted>"
   ```
   The rules are:
   1. every "et al." in a citation is italic
   2. every table carries a full grid of borders, and the cells of the first
      row are aligned to the top and to the centre
   3. the cover page is centred
   4. the text is set at one and a half lines
   5. the reference list is justified from the left margin to the right margin
   6. a heading, a title or a subtitle carries no italic

   Reason: a manuscript is usually submitted as a document that was typed and
   never laid out, and the things that give it away are mechanical rather than
   linguistic. A table whose vertical rules have vanished, a cover page that
   has drifted left, a reference list that stops short of the right margin and
   a heading in italic all read as an unfinished draft even when the argument
   is sound. Each rule can be switched off on its own, so a document that
   already looks right is not changed for the sake of it:
   ```
   node scripts/format-docx.mjs "<target>" --out "<formatted>" --no-table-borders
   node scripts/format-docx.mjs "<target>" --out "<formatted>" --single-spacing
   ```

   Two kinds of paragraph keep their own spacing under rule 4, because
   stretching them is wrong rather than merely unusual: a source-code listing,
   where the spacing is part of the code, and a table cell, where the row
   height belongs to the table. A caption recognised from its content keeps its
   italic under rule 6, because that is how a table caption is written; only
   the Word styles Heading 1 to Heading 6, Title, Subtitle and Caption lose
   their italic.

   The engine runs sixteen ordered stages, each with its own fire rate: phrase
   rewrites, the stock word swaps, inflection-aware synonym substitution,
   determiner cycling, clause reordering, voice transformation, split and fusion,
   transition injection, discourse rotation, hedge insertion, de-nominalisation,
   appositive insertion, a cadence repair, an opener change, a document-level
   rhythm pass, and a final deterministic chain breaker that measures the output
   against the source and keeps breaking matched runs until no run of eight words
   or more survives. It is deterministic, so the same input always gives the same
   output, and it never touches a protected span: numbers, units, citations,
   quotations, code and protected terms are masked before stage one and restored
   afterwards.

   Three of those stages exist because a commercial AI detector reads the shape
   of a document before it reads its words:
   - the **stock word** stage swaps the words a language model reaches for
     because they are the safe choice, such as "robust", "comprehensive",
     "crucial", "significantly" and "demonstrate", for plainer words that carry
     the same meaning. The bank is `rules/tells.json`, and a word is left alone
     when it is part of a compound, when it is a name, or when the swap would
     write a stock phrase that the audit would flag.
   - the **cadence repair** measures the paragraph and repairs it only when its
     sentences all run to about the same length. A long sentence is cut in two
     where both halves are clauses of their own, or two neighbours are joined,
     and the repair is kept only when it raises the variation. The thresholds
     are in `rules/rhythm.json`.
   - the **opener change** moves a trailing subordinate clause to the front of
     its sentence, so that two sentences in a row stop opening with the same
     words.

   On a document that a person has to sign their name to, run the engine in
   the safe mode, which keeps only the stages that cannot change the meaning of
   a sentence:
   ```
   node scripts/transform.mjs "<target>" --plan "<plan.json>" --safe
   ```
   Reason: the stylistic stages trade meaning for variety, and a paper in a
   technical field is not the place to take that risk.

   The engine deliberately leaves paragraphs alone when rewriting them would
   damage them. It recognises those paragraphs from their **content**, not
   from their Word style, because a submitted manuscript usually has every
   paragraph on the "Normal" style and no heading styles at all. The guard
   classifies each paragraph as prose, title, heading, label, caption, code,
   table or reference, and only ordinary prose is rewritten. It catches:
   - numbered headings such as "2.4 Adaptive and Robust Control Strategies",
     at any depth, and appendix headings such as "A.1 Complete Script"
   - figure and table labels ("Figure 1"), their captions and their notes
   - source-code listings, including MATLAB and Python, comments, section
     markers, assignments, tuple assignments and docstrings
   - the reference list, from the "References" heading to the next heading
   - short centred display paragraphs: the title, the author block, an
     abstract heading, an appendix title
   - table cells, which are reported separately

   A paragraph whose runs carry different properties, such as a citation whose
   "et al." is italic, is no longer skipped. The rewrite is applied word by
   word: every word the rewrite kept keeps the run it came from, and every
   word it introduced takes the properties of the word before it, so the
   styling of the paragraph survives.

   Then run the transformation ladder in order for whatever remains.
   Use `references/transformation-rules.md` for the rule banks and the fire rates.
   Use `references/detection-mechanics.md` for the reasoning behind the ladder and for
   the table that maps an audit finding to the specific change that fixes it.
   - L1 lexical: phrase rewrites, then content-word synonyms, then determiner cycling.
   - L2 structural: voice inversion, clause split and fusion, clause fronting,
     nominalisation, appositive insertion.
   - L3 semantic: proposition reordering inside a paragraph, granularity shift, one short
     original bridging sentence.
   - L4 discourse: rotate discourse markers so no marker repeats more than twice.
   Reason: each layer breaks a different detector. Synonym swapping alone leaves the
   syntax tree and the sentence embedding nearly untouched, so a document that only
   passes L1 still reads as a clone to both the structural and semantic layers. The
   ladder must run in order because each layer assumes the previous one has run.

5. **Apply the structural diversity rule.**
   Every sentence longer than 60 characters needs at least two independent structural
   changes (voice inversion, clause movement, nominalisation, splitting, fusion).
   Reason: one structural edit leaves the sentence's shape recognisable, and the shape
   is what the structural matcher scores.

6. **Re-audit and iterate.**
   Run the audit again on the rewritten file. Work the residual chain list until no
   chain of five or more identical words survives against the source, and no chain of
   eight or more words remains (eight is the point at which a match is essentially
   always caught). Fix the chains the script lists; do not blanket-rewrite the document.
   Reason: the residual chain list is the precise, minimal fix set. Broad rewriting
   introduces new errors to solve a problem that was already solved.

   When the worry is an AI detector, run the pressure analyser again and compare
   it with the baseline. Report the two sets of numbers side by side, in the
   terms the proxy measures. Do not report a detector percentage, and do not
   promise one: say plainly that the classifier is private, that its threshold
   changes without notice, and that the user has to run the check on their own
   account to see the number their service gives.

7. **Run the integrity check.**
   Read the rewritten section against the original and confirm: every number, name,
   citation and claim is unchanged, the argument and conclusion are unchanged, no new
   claim was introduced, and quoted material is still marked as quoted.
   Reason: this is the step that separates legitimate rewriting from falsification, and
   it is the step that catches the accidental meaning drift that heavy synonym work
   causes.

8. **Deliver the rewritten file plus the audit report.**
   Both go to the user. The report is what makes the change reviewable.

## Intensity dial

Use the lowest setting that clears the target. Higher settings raise similarity risk
fast and cost readability.

| Level | L1 lexical | L2 structural | L3 semantic | L4 discourse | Use when |
|---|---|---|---|---|---|
| Light | 40% | 10% | 10% | 30% | Own work, boilerplate only |
| Standard | 70% | 25% | 20% | 50% | Default for a flagged draft |
| Heavy | 90% | 40% | 35% | 70% | Only when a source is quoted at length |
| Maximum | 100% | 60% | 50% | 90% | Last resort; prose quality usually suffers |

Two rules that apply at every level: appositives are inserted at most once per term per
document, and each discourse marker is rotated to a form not used elsewhere in the same
document. Repeating a marker is itself a detector signal.

## Output contract

- The rewritten document as a file, in the user's requested format, written to a new
  path unless the user asked for in-place editing.
- A short summary listing the transformation types applied, the count of each, and the
  audit figures before and after.
- The audit output itself, so the user can see the residual chain list and the style
  signals. Do not summarise the audit away.
- The final alignment state: justified, or left as it was if the user asked for
  `--no-justify` or the document was not a Word file.
- The final formatting state: which of the six rules were applied and how many
  paragraphs each one touched, or a note that `--no-format` was used.
- The citation report, when the citation engine was run: the style in force, the
  citations with no entry, the entries that are never cited, the links that did
  not pass, and the style rules that were broken. Give it as a report beside the
  document. Never put warning markup inside the manuscript.
- A plain statement that no similarity or detection score is guaranteed.

## Failure handling

- **Audit script errors on the file**: check the extension. `.docx` is read as a zip
  package, `.tex` is read as LaTeX source, everything else is read as plain text. For an
  unsupported format, convert to `.md` first and audit that.
- **The script finds zero residual chains but the user still sees a high score**: the
  match is coming from a source not supplied to the audit, from the reference list, or
  from boilerplate that the report excluded. Ask for the similarity report's source
  list before rewriting again.
- **Rewriting damages the document**: revert to the backup copy and reduce the
  intensity level. Heavy lexical substitution on method sections damages the technical
  precision that makes the section correct.
- **The prose becomes unreadable after L1**: the synonym bank was too aggressive for the
  discipline. Drop back to the phrase-rewrite and structural layers, which break more
  chains per unit of damage than word-level substitution.
- **The citation audit reports many unused references**: check that the reference
  list was recognised. A list under a heading the guard does not know, such as
  "Bibliography" written in a language the guard does not read, is not found and
  every entry of it looks unused. Run the audit on the plain text of the
  document to check.
- **A citation is reported missing but the reference is there**: the two halves
  have to agree on the year and on the name. A reference that gives the year in
  a different place, or a name that the text shortens, will not match. Read the
  two entries before changing anything.
- **The document is LaTeX and stops compiling**: restore the masked zones from
  `references/format-protection.md` and re-run. Structural changes must not touch
  command arguments.

## Examples

**Input**: "My Turnitin report says 38 percent on the methodology section. It is a .docx
and the flagged source is an older version of my own dissertation."

**Action**: Audit the `.docx` against the source to find which chains survived. Run the
ladder at Standard on the methodology prose only, leave the equations, the parameter
table and the citations untouched, re-audit until the chain list is empty, then deliver
the rewritten `.docx` plus both audit reports.

**Input**: "Can you make this essay so AI detectors do not flag it?"

**Action**: Run the audit first and report what the detector-visible signals actually
are (uniform sentence rhythm, repeated discourse markers, trigger phrases). Fix those.
State plainly that no detector score can be guaranteed, because the classifier changes
without notice and the vendor does not publish its thresholds.

## Windows (win32) platform notes

Scripts are Node.js with no third-party dependencies, so they run with `node` on
Windows, macOS and Linux. Use PowerShell syntax for any surrounding commands:

```powershell
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\audit.mjs" "C:\path\draft.docx" --source "C:\path\source.txt"
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\transform.mjs" "C:\path\draft.docx" --out "C:\path\draft-rewritten.docx" --source "C:\path\source.txt" --plan "C:\path\plan.json"
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\transform.mjs" "C:\path\draft.docx" --out "C:\path\draft-rewritten.docx" --rules "C:\path\my-discipline-rules" --plan "C:\path\plan.json"
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\rewrite-docx.mjs" "C:\path\draft.docx" --out "C:\path\draft-rewritten.docx" --plan "C:\path\plan.json"
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\justify-docx.mjs" "C:\path\draft.docx" --out "C:\path\draft-justified.docx"
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\format-docx.mjs" "C:\path\draft.docx" --out "C:\path\draft-formatted.docx"
node "C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn\scripts\purge.mjs" "C:\path\draft.docx" --out "C:\path\draft-clean.docx"
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\fetch_patterns.py" --force
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\pattern_lint.py" "C:\path\draft.docx" --no-title-page-no-refs
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\live_checkers.py" "C:\path\draft.docx" --out-dir "C:\path\checks"
```

Use `node`, never `nodejs`. Do not use `python3` for these scripts; they are Node on
purpose so they run without an extra interpreter. The scripts use the `.mjs` extension,
so they run as ES modules on Node 14 and later with no `package.json` and no
`"type": "module"` setting required. Resolve the skill root from the path
this SKILL.md was loaded from. On this machine it is
`C:\Users\imalp\.minimax\skills\plagiarism-minimiser-kdbn`.

Script reference:

- `scripts/audit.mjs <file> [--source <file>] [--k 5] [--json]` reports residual matched
  chains against the source, invisible Unicode, sentence-length variation, lexical
  diversity, discourse-marker repetition, trigger-phrase hits, compression entropy and
  paragraph alignment.
- `scripts/transform.mjs <file> --out <file> [--source <file>] [--intensity
  light|standard|heavy|max] [--plan <plan.json>] [--rules <dir>] [--seed <n>]
  [--dry-run]` runs the sixteen-stage rewriting engine. It writes a plan for a
  `.docx` input and the rewritten file for a text input. `--rules <dir>` points
  the engine at a different set of word banks, so a discipline-specific set of
  protected terms can be kept without changing the shared banks. The directory
  has to hold a complete set of banks; build it by copying `rules/` and adding
  to `protected_terms.json`. The shared banks are written for general academic
  English, and a discipline file is where the judgement about a field belongs:
  remove the lemmas whose substitutes are wrong for the field, narrow the
  pools that are too loose, and protect the terms the argument depends on.
  A discipline file that is built this way is what keeps the engine from
  swapping "system" for "framework" in an aerospace paper, or "empirical" for
  "observational" in a results section.
- `scripts/lib-guard.mjs` is the shared classifier. It reads the paragraphs of
  a Word document and decides which of them are prose that may be rewritten.
  Both the rewriting engine and the justification helper use it, so the two
  always agree on what may and may not move.
- `scripts/rewrite-docx.mjs <in.docx> --out <out.docx> --plan <plan.json> [--no-justify] [--no-format]`
  applies run-level and paragraph-level replacements with hard safety checks on match
  count, protected strings, paragraph count, italic runs and table XML. A plan entry
  with `"paragraph": true` replaces the full plain text of one paragraph, and the run
  is refused if that paragraph carries mixed run formatting. The document is
  justified on the way out unless `--no-justify` is given, and the six formatting
  rules are applied unless `--no-format` is given. While the formatting rules
  run, the italic-run and table-XML checks are replaced by a plain-text check, so
  the formatting can change the look of the document but never its words.
- `scripts/justify-docx.mjs <in.docx> --out <out.docx> [--include-headings] [--dry-run]`
  justifies a Word document without changing its text. It sets every body paragraph
  and every reference entry to reach both margins, whatever the original alignment
  was, and leaves table cells and headings alone.
- `scripts/format-docx.mjs <in.docx> --out <out.docx> [--dry-run]` applies the six
  formatting rules to a Word document without changing its text. Every rule can be
  switched off on its own: `--no-justify`, `--no-justify-references`,
  `--no-cover-centre`, `--no-table-borders`, `--no-table-header-align`,
  `--no-heading-italic-off`, `--no-citation-italics`, `--single-spacing`,
  `--double-spacing` and `--line-spacing <twips>`.
- `scripts/lib-format.mjs` holds the six formatting rules and the schema-order
  tables they use. Every element is written in the order the WordprocessingML
  schema demands, because Word repairs a file whose elements are out of order and
  the repair can drop the setting that was being applied.
- `scripts/purge.mjs <file> [--out <file>] [--dry-run]` strips invisible Unicode from
  text, `.md` and `.tex` files, and from `.docx` packages, and removes C2PA content
  credential parts and their relationships.
- `scripts/lib-inflect.mjs` is the morphological engine the transform uses, so that a
  replacement keeps the plural, third person, past, participle, gerund or adverb form
  of the word it replaces.
- `rules/` holds the word banks the transform reads: phrase rewrites, synonyms,
  determiners, transitions, discourse markers, hedges, protected terms,
  nominalisations and appositives. They are plain JSON, so a user can extend them
  for their own discipline.
- The companion skill `C:\Users\imalp\.minimax\skills\live-ai-pattern-check` holds
  the live side of the chain: `fetch_patterns.py` reads the current Wikipedia
  pattern list, `pattern_lint.py` lints the document against that live list, and
  `live_checkers.py` prepares the body for the live checkers and attempts the
  endpoints that can be called without an account. The scripts are Python, so run
  them with `python`, not `node`.

---

*Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved. Licensed under the MIT Licence.*
