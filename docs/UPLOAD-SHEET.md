# GitHub upload sheet for MASH-AI-Text-Diector-and-Humaniser

Everything you need to create the repository on github.com and push the folder.

## Repository name

    MASH-AI-Text-Diector-and-Humaniser

## Description (the "About" field, 100 character limit)

    One agent skill for the academic writing audit chain: live AI pattern detection, humanising, similarity audit and a proof run.

## Topics (the "Topics" field on the repo landing page, up to 20)

    ai-writing-detection
    ai-detector
    humanise-text
    humanizer
    ai-pattern-checker
    wikipedia-signs-of-ai-writing
    plagiarism-checker
    similarity-check
    turnitin
    paraphrasing
    citation-audit
    harvard-referencing
    academic-writing
    docx
    agent-skill
    claude-code-skill
    codex-skill
    opencode-skill
    offline
    zero-dependencies

## Description, long form (the repo description on the landing page)

    One skill for the whole academic writing audit chain. It fetches the live Wikipedia
    signs of AI writing page on every run, lints your document against it, removes the
    named AI patterns from your own prose, measures and reduces the similarity against
    the source you name, then runs both measurements again over the same body and reports
    the before and after numbers. Every measurement covers the body only: the cover page,
    the contents page and the reference list are excluded. Node.js 18 or newer and Python
    3.9 or newer, no third party package, MIT licensed.

## SEO keywords (for the description body, for search engines and for the README)

    AI writing detection, AI detector, humanise text, humanizer, AI pattern checker,
    Wikipedia signs of AI writing, academic integrity, plagiarism checker, similarity
    check, similarity report, Turnitin, paraphrasing, citation audit, Harvard referencing,
    docx, agent skill, Claude Code skill, Codex skill, opencode skill, MIT licence,
    offline, zero dependencies, English academic writing, Word document, batch audit.

## Steps to publish

1. Open https://github.com/new
2. Owner: kdbn121
3. Repository name: MASH-AI-Text-Diector-and-Humaniser
4. Description: copy the short description above
5. Visibility: Public
6. Do NOT tick "Add a README file", "Add .gitignore" or "Choose a licence". The folder already has all three.
7. Click "Create repository"
8. Open GitHub Desktop, or a terminal, in the folder
       C:\Users\imalp\Projects\MASH-AI-Text-Diector-and-Humaniser
9. Add the remote and push
       git remote add origin https://github.com/kdbn121/MASH-AI-Text-Diector-and-Humaniser.git
       git push -u origin main
10. Set the topics on the repo landing page, in the gear icon beside "About"
11. Upload the social preview image
       Settings > General > Social preview > upload docs/images/social-preview.png
12. Read the run under the Actions tab so the CI badge turns green

## What the folder already contains

- A clean git history on the branch `main`, two commits, no working copy changes.
- The MIT LICENSE with the KDBN mark.
- The CI workflow, the issue templates, the pull request template and CODEOWNERS.
- The photo card, the social preview and the chain diagram as PNGs.
- The HTML sources and the render script, so the images can be regenerated.

## What CI checks on every push

- `node scripts/lint-skill.mjs` must pass: the skill file, the scripts and the thirteen word banks.
- `node scripts/selftest.mjs` must pass: 217 checks across the whole engine.
- The live pattern lint must return exit 0 on `examples/clean-sample.txt`.
- The live pattern lint must return exit 1 on `examples/control-ai-sample.txt`, so a lint that finds nothing is caught.
