# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-18

### Added

- The live citation check, `scripts/live_citation_check.py`, which verifies a reference
  list against the live scholarly databases. Every DOI is resolved at the Crossref REST
  API, and every entry without a DOI is looked up by title at Crossref and at the
  Semantic Scholar Graph API. The record is compared with the entry on the title, the
  first author, the year, the volume, the issue and the pages.
- The verdicts VERIFIED, METADATA DIFFERENCE, DOI MISMATCH, MATCH FOUND, VERIFY MANUALLY
  and CHECK FAILED, with the differences named one by one. An endpoint that does not
  answer is reported as a failure, never as a verdict on the reference.
- The style entry `obu-harvard` in `rules/citation_styles.json`, for the Open University
  Harvard style: three or more authors give the abbreviation in the text, the
  abbreviation is italic, and every author is listed in the reference list.
- The citation checker routes in `references/live-checkers.md`, with the manual command
  for the free browser based checker and the rule for reading its verdicts.
- Seven self test checks for the live citation check, including the case where an
  apostrophe in a surname must not be read as the opening quote of an article title.

### Changed

- The academic editor stage in `SKILL.md` now names the live citation check and the
  command that runs it.

### Notes

- The reference list is read for the citation check and the style findings, because the
  reference list is where the italics live. Every other stage still measures the body
  only.
- A VERIFY MANUALLY verdict means the databases did not return a record. Books, reports,
  chapters and very recent work are often absent from these indexes, so it is a reason
  to check by hand and never a verdict of guilt.

## [1.0.0] - 2026-11-18

### Added

- The merged skill `MASH-AI-Text-detector-and-Humaniser`, one skill that runs the
  academic editor stage, the live pattern check, the humaniser stage, the similarity
  audit and the proof run in a fixed order.
- The live pattern scripts, `fetch_patterns.py`, `pattern_lint.py` and
  `live_checkers.py`, which fetch the Wikipedia signs of AI writing page on every
  run, lint the body against it and route the live checker calls.
- The writing rules and the humaniser catalogue, `rules/writing-rules.md` and
  `rules/humanizer-rules.md`, with no attribution to any person or company.
- The live checker routes in `references/live-checkers.md`, with the manual command
  for each checker and the rule for reporting what they returned.
- The photo card, the social preview and the chain diagram under `docs/images`, with the
  HTML sources and `docs/images/source/render_images.py` beside them so every image can
  be regenerated with one command.
- Continuous integration that runs the engine self test, the skill linter and the
  live pattern lint against a clean sample and a machine flavoured control sample.
- The examples folder with a sample source, a plan file and the two lint samples.

### Notes

- Every measurement is taken over the body. The cover page, also called the title
  page, the contents page and the reference list are excluded.
- A live checker that cannot be reached is reported as a failure with the reason and
  the manual command. No score is invented and no score is guaranteed.
