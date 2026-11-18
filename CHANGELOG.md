# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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
