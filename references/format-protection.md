# Format protection

The similarity score is never worth a broken equation, a mangled citation or a
paragraph that lost its meaning. Protection comes first, rewriting second.

## The masking principle

1. Build the protected list before rewriting.
2. Mask every protected region with a sentinel that contains no word characters.
3. Run the transformation ladder over what remains.
4. Restore the sentinels.

A sentinel must not contain letters, because the comparison normalisation lowercases
and strips punctuation but keeps word characters. A sentinel such as `\x00PROT0\x00`
works: it contains no letters, so it never forms a 5-gram with real words.

## What always stays protected

- Numbers, units, percentages, currency, dates, statistical values, p-values, effect
  sizes, confidence levels, test names, model names and version numbers.
- Equations, in any notation.
- Citations, citation keys and reference list entries.
- Direct quotations, and the ellipsis or bracket around them.
- Proper nouns, and any term defined earlier in the document.
- Code, commands, file paths, URLs, identifiers, API names, product names.
- Table and figure content, including headers and captions.
- Headings and subheadings, unless the user asks for them to change.
- Anything the user has marked as untouchable.

## DOCX

WordprocessingML keeps text in runs inside paragraphs, and a paragraph can hold several
runs with different formatting (bold, italic, superscript, font size, colour). Editing
the paragraph as plain text and writing it back destroys that structure.

**Safe approach.** Edit at run level. For each paragraph you want to change:

1. Read the paragraph's runs and reconstruct its full text.
2. Decide the replacement text.
3. If every run in the paragraph carries identical run properties, put the whole new
   text into the first run and delete the remaining runs. This preserves the paragraph
   mark, its style, its alignment and its numbering.
4. If the runs differ (for example an italicised term inside a normal sentence), edit
   only the runs that need changing, and keep the length of the untouched material
   aligned so the formatting stays with the right words.

**Never do these to a DOCX:**

- Read the file, join the text, rewrite it, and write it back as one run. This flattens
  every bold, italic, footnote anchor, hyperlink and field in the document.
- Rewrite a table cell as though it were body text. Table structure lives in the
  document XML, not in the paragraph tree.
- Touch `word/document.xml` directly with a text editor. Word will repair the file, and
  the repair usually discards content.
- Delete a paragraph. Paragraph marks carry list numbering, spacing and style
  inheritance.
- Assume a paragraph's runs are interchangeable. Check first.

**Sections, headers and footers.** These live in separate parts
(`word/header1.xml`, `word/footer1.xml`). Page numbers and running heads are
reproduced on every page, so a phrase change in the header multiplies across the
document. Check them separately when the similarity report flags the header area.

**Footnotes and endnotes.** Their text is in `word/footnotes.xml` and
`word/endnotes.xml`. A footnote that paraphrases a source is a common residual match,
so rewrite the footnote body, not the reference marker.

## Alignment

Paragraph alignment is a separate concern from the text, and it is stored in the
paragraph properties rather than in the runs:

- justified, both margins reached: `<w:jc w:val="both"/>`
- left aligned: `<w:jc w:val="left"/>`
- centred: `<w:jc w:val="center"/>`
- right aligned: `<w:jc w:val="right"/>`
- no explicit setting, so the document default applies

The element has to go into the paragraph properties in the order the
WordprocessingML schema requires: after `w:spacing` and `w:ind`, and before `w:rPr`
and `w:sectPr`. Word will repair a file where the order is wrong, and the repair
can drop the setting.

**Two places alignment must not be changed.**

- **Table cells.** A cell has its own width. Justifying inside one opens large gaps
  between words, and the table stops looking like a table.
- **Headings, titles and captions.** A centred title stays centred in a paper that
  is otherwise justified. Justifying it makes the title look like body text.

**One place where it usually should be changed.** A body paragraph that was left
aligned, right aligned or centred when it did not need to be. Justified text is the
normal setting for a submitted paper, and it makes the right edge of the page
straight, which is what a marker expects to see.

Justified text has a cost. In a narrow column, or a column set in a large font, the
word spacing can open into visible gaps. That is a layout problem, not a writing
problem, and the fix is a wider text area or a smaller font rather than leaving the
alignment alone.

## LaTeX

**Protect these regions:**

- Inline math `$...$` and display math `$$...$$`, `\[...\]`.
- Math environments: `equation`, `align`, `gather`, `multline`, `eqnarray`, `cases`,
  `matrix`, `pmatrix`, `bmatrix`, `array`.
- Command arguments: `\cite{}`, `\citep{}`, `\citet{}`, `\ref{}`, `\eqref{}`,
  `\label{}`, `\includegraphics{}`, `\url{}`, `\href{}`, `\footnote{}`, `\input{}`.
- `verbatim`, `lstlisting`, `minted` and `tikzpicture` environments, entirely.
- `\newcommand` and `\renewcommand` definitions, and the preamble.
- `tabular`, `figure` and `table` environments, including captions.
- `%` comments.

**Approach.** Mask each region with a sentinel before rewriting, restore afterwards, and
recompile if a LaTeX toolchain is available. If it cannot be compiled, at minimum
re-check that every sentinel has been restored and that the brace balance is unchanged.

**LaTeX specifics that break silently:**

- A phrase that spans a line break in the source is still one sentence in the output.
  Rewriting per line produces fragments. Work on paragraph units, not lines.
- `\cite{a}` and `\cite{a,b}`: the keys must survive exactly.
- A `~` is a non-breaking space and counts as a word separator in the compiled PDF but
  not in the source text. Rewrite prose around it, not through it.
- Escaped characters (`\%`, `\&`, `\_`, `\$`) must keep their backslash.

## Markdown

Protect fenced code blocks (```` ``` ```` and `~~~`), indented code blocks, inline code
spans, link targets and images, HTML blocks, tables, and footnote definitions. The
substance of a markdown document is usually in the prose between them, so masking the
code fences and the link syntax is normally sufficient.

Keep link syntax intact while rewriting link text. `[**Read the study**](https://...)`
becomes `[Read the survey](https://...)`, never a bare URL.

## Source code

Only comments and docstrings are prose, so only comments and docstrings are candidates
for rewriting. A string-aware pass is required: a `#` inside a string literal is not a
comment, and a `//` inside a URL is not a comment.

- Python: `#`, `"""..."""`, `'''...'''`
- C, C++, Java, C#, JavaScript, TypeScript, Go, Rust: `//`, `/* ... */`, `/** ... */`
- Shell: `#` at the start of a line, not inside a here-document
- SQL: `--`, `/* ... */`
- HTML and CSS: `<!-- ... -->`

Comments must stay valid in their language: a Python comment keeps the `#`, a block
comment keeps both delimiters, and the comment body must not contain the closing
delimiter. Indentation and line breaks inside a block comment are preserved so the
comment stays where the reader expects it.

## Terminology consistency

If the document defines a term, that term stays. If a synonym is introduced for a
concept that recurs, it is used consistently afterwards. Alternating between
"participants", "respondents" and "subjects" across one document reads as machine
output and, worse, changes the apparent meaning of the sample.

Track every substitution you make. A list of the substitutions is the cheapest way to
catch an unintended meaning change before delivery, and it is also the honest record of
what was altered.

## Spelling and locale

Match the spelling convention already in the document. Do not introduce American
spellings into a British document or the reverse, and do not mix within one document.
If the document uses -ise endings, every rewrite uses -ise endings.

## Checklist before delivery

- Every masked region restored, none left as a sentinel.
- All numbers, units and statistical values identical to the original.
- All citations and reference list entries identical to the original.
- Quotations still marked as quotations.
- No new claim, no strengthened claim, no dropped qualifier.
- Terminology consistent, spelling convention consistent.
- File opens in Word (or compiles if LaTeX) and the layout is unchanged.

---

*Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved. Licensed under the MIT Licence.*
