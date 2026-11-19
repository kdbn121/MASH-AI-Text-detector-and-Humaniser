# Live checkers

The live AI writing and similarity checkers this skill can reach, and the exact
manual command for each. The manual command is kept in this file on purpose: when
the automated call does not answer, the check is still completed by hand, and the
result is still reported honestly.

## Body only

Every checker run works on the body of the document. The cover page, also called
the title page, the contents page and the reference list are removed before the text
is chunked, because a reference list quoted in full is always a perfect match and a
cover page carries no prose. That is the same treatment the lint and the local
similarity audit use, so the three measurements agree.

## The checkers

### ZeroGPT

- Site: <https://www.zerogpt.com>
- Automated endpoint attempted: `https://api.zerogpt.com/v1/detect`, POST, form field `text`.
- Manual command: open <https://www.zerogpt.com>, paste the chunk into Detect Text, press check, and read the AI verdict and the highlighted sentences.
- Note: the free web tool reads a limited number of characters per check and scores the pasted text, not the file. Paste one chunk at a time.
- Observed from this machine: the endpoint returns HTTP 404, so the automated call does not answer and the manual step is used. A 404 is a failure and is reported as a failure, never as a score.
- Observed in the browser on 2026-11-18: the site loads, but a cookie consent dialog from a third-party consent manager covers the page. The "Reject All" control sits inside a cross-origin consent frame, so an automated click does not reach it. The checker is therefore completed by hand after dismissing the dialog, or through a different checker.

### GPTZero

- Site: <https://gptzero.me>
- Automated endpoint attempted: none, there is no account-free endpoint.
- Manual command: open <https://gptzero.me>, sign in with a free account, paste the chunk into the detector and read the AI and plagiarism percentages.
- Note: reports an AI percentage and a similarity percentage.

### Originality.ai

- Site: <https://originality.ai>
- Automated endpoint attempted: none, an account is required.
- Manual command: open <https://originality.ai>, use the free scan on the chunk, and read the AI probability and the plagiarism percentage.
- Note: free scan credits on signup.

### Copyleaks

- Site: <https://copyleaks.com>
- Automated endpoint attempted: none, an account is required.
- Manual command: open <https://copyleaks.com> and run the free plagiarism or AI report on the chunk.
- Note: a free report without an account for a limited number of pages.

### Plagiarism Checker AI

- Site: <https://plagiarismchecker.ai/>
- AI detector page: <https://plagiarismchecker.ai/ai-content-detector/>
- Automated endpoint attempted: none, there is no account-free endpoint.
- Manual command: open <https://plagiarismchecker.ai/>, paste the chunk into the text box and press Check Plagiarism for a similarity figure. For an AI verdict, open <https://plagiarismchecker.ai/ai-content-detector/>, paste the chunk and press Detect AI content, then read the Human and AI Written percentages.
- Note: free web check, no account needed, no consent wall. The free limit is about 1,000 words per check, so a long document needs several checks, one slice at a time.
- Observed from this machine on 2026-11-18: both checks completed. The AI detector returned 81% Human and 19% AI Written on a 585 word body slice, and the plagiarism check returned 0% plagiarised, 0% exact match, 0% partial match, 100% unique content.

### Undetectable AI

- Site: <https://undetectable.ai>
- Automated endpoint attempted: none, an account is required.
- Manual command: open <https://undetectable.ai> and run the free detector on the chunk.
- Note: free web detector.

### Sites removed from this list

- CompWrite, <https://compwrite.com>: the domain does not resolve from this machine, so it was removed rather than left as a broken route.

## The citation checkers

### ProofreaderPro AI Citation Checker

- Site: <https://proofreaderpro.ai/ai-citation-checker>
- Automated endpoint attempted: none, the page runs the checks in the browser.
- Manual command: open the site, paste the reference list, one reference per line, press
  Check references and read the verdict for each entry.
- Note: free, no sign-up, up to 100 references per run. The page verifies every DOI
  against Crossref and Semantic Scholar in the browser, and a non-DOI entry is matched on
  its title, first author and year.
- The four verdicts are VERIFIED, MATCH FOUND, DOI MISMATCH and VERIFY MANUALLY. A
  fifth outcome, CHECK FAILED, means the databases could not be reached from the browser
  at that moment.
- Observed on 2026-11-18 from this machine: the page loads and the check runs. On a
  42 entry list it returned 24 verified, 7 matched, 9 to verify manually and 2 failed.
- Caution: a MATCH FOUND on a grey literature entry is often a loose title match to an
  unrelated work. The matched record is shown, so the title, the author and the year of
  the record must be compared with the entry before the reference is changed.

### The automated live citation check

The same databases are reachable directly, without the browser, so the check can be run
from the command line and repeated as part of a chain.

```
python scripts/live_citation_check.py "<file.docx>" --out-dir "<dir>"
python scripts/live_citation_check.py "<refs.txt>" --style obu-harvard
python scripts/live_citation_check.py "<file.docx>" --style harvard --json
```

The script reads a DOCX or a text file of references. For every entry it resolves the
DOI at the Crossref REST API, and when there is no DOI it searches Crossref and the
Semantic Scholar Graph API by title. It compares the record with the entry on the title,
the first author, the year, the volume, the issue and the pages, and it reports one of:

- VERIFIED: the DOI resolves to a real record and the title matches.
- METADATA DIFFERENCE: the DOI resolves to the right work but a detail differs, for
  example the year of the online record and the year of the printed issue. Each
  difference is named.
- DOI MISMATCH: the DOI resolves to a different work, or does not resolve at all.
- MATCH FOUND: a real record matches the title, the author and the year.
- VERIFY MANUALLY: no record was found in the databases that were checked.
- CHECK FAILED: an endpoint did not answer. It is reported as a failure, never as a
  verdict on the reference.

The script also reports the offline style findings it can see in a DOCX, including a
roman "et al." where the style asks for an italic one. The reference list is read for
this check, because the reference list is where the italics live.

The report and the JSON record are written to the output folder as
`live-citation-check.txt` and `live-citation-check.json`.

## Running the preparation

```
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\live_checkers.py" "<file.docx>" --out-dir "<dir>"
```

The script prints, in order:

1. The units extracted, the chunk count and the path of every chunk file.
2. The state of each automated endpoint: ANSWERED, NOT CALLED or FAILED, with the
   reason.
3. The manual command for every checker, so a failed call has a route to a real
   result.
4. The path of the `.live-check.json` record.

To list the checkers and the manual commands without running a file:

```
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\live_checkers.py" --list
```

## Recording a result

For each checker that was run, record:

- the checker name
- which chunk was pasted, by chunk number and character count
- the number the checker returned, quoted as it was returned
- the date, because these tools change
- the failure reason, when the call did not answer

Never estimate a number, never carry a score over from a previous document, and
never describe a checker as having passed when it returned a failure. If no live
checker could be reached, the report says so plainly and gives the manual command.

## What a number does and does not mean

The detectors score the text that was pasted into them. A score on the first chunk
is a score on that chunk, not on the document. The figure also moves with the
checker, the version and the date, and the thresholds are not published.

A similarity percentage from a free web tool is an estimate against a partial
index. It is a signal about wording, not a judgement about authorship, and it is
not a percentage that can be promised in advance.
