#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// rewrite-docx.mjs — safe run-level paragraph rewriting for .docx.
//
//   node scripts/rewrite-docx.mjs <in.docx> --out <out.docx> --plan <plan.json>
//                                [--no-justify] [--no-format]
//
// The document is justified on the way out, whatever alignment it had before,
// so every body paragraph reaches both margins. Table cells and headings are
// left as they are. Use --no-justify to keep the original alignment.
//
// The six formatting rules are applied as well, unless --no-format is used:
// the "et al." in a citation is italic, every table carries a full grid of
// borders with its first row aligned top and centred, the cover page is
// centred, the text is set at one and a half lines, the reference list is
// justified and a heading or a title carries no italic.
//
// Plan file:
//   {
//     "replace": [ { "old": "exact current text of one run", "new": "replacement text" } ],
//     "protect": [ "text that must survive byte-identical" ]
//   }
//
// A plan entry may also carry "paragraph": true. In that case "old" is the
// full plain text of one paragraph, which may be split across several runs.
// The new text is written into the first run of that paragraph and the other
// runs are emptied. The run is aborted unless every run in the paragraph
// carries identical run properties, so a paragraph with mixed formatting
// (for example a word in italics) is never flattened by accident.
//
// Guarantees, all checked before the file is written:
//   - every "old" string matches exactly one run or paragraph, otherwise the
//     run aborts
//   - every "protect" string is still present and unchanged afterwards
//   - paragraph count, table XML and italic-run count are unchanged
//   - every package part other than word/document.xml is byte-identical
//
// The formatting pass is allowed to change the italic runs and the table XML,
// because that is what it is for, so the text check replaces those two checks
// while it runs: the plain text of the document must be exactly the plain text
// of the rewritten document.
//
// Only the text inside a single <w:t> is replaced, so the paragraph mark, its
// style, its numbering and the run properties are all preserved.

import { readFileSync, writeFileSync } from 'node:fs';
import { readZip, writeZip } from './lib-zip.mjs';
import { justifyDocumentXml } from './lib-justify.mjs';
import { applyFormatting } from './lib-format.mjs';

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseArgs(argv) {
  const args = { input: null, out: null, plan: null, justify: true, format: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--plan') args.plan = argv[++i];
    else if (a === '--no-justify') args.justify = false;
    else if (a === '--no-format') args.format = false;
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

/**
 * The plain text of a document, paragraph by paragraph.
 *
 * Used to prove that a formatting pass changed the look of the document and
 * not its words.
 */
function plainText(xml) {
  const out = [];
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(m[0])) !== null) texts.push(decodeEntities(t[1]));
    out.push(texts.join(''));
  }
  return out.join('\n');
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function extractTableXml(xml) {
  const start = xml.indexOf('<w:tbl>');
  if (start === -1) return '';
  const end = xml.indexOf('</w:tbl>', start);
  return end === -1 ? '' : xml.slice(start, end + '</w:tbl>'.length);
}

function countTags(xml, tag) {
  return countOccurrences(xml, '<' + tag);
}

/**
 * Count real paragraph elements.
 *
 * A plain prefix count on "<w:p" would also match "<w:pPr>", "<w:pStyle>" and
 * "<w:pict>", so the boundary has to be checked: the character after "w:p" must
 * not be a letter.
 */
function countParagraphs(xml) {
  return (xml.match(/<w:p\b[^>]*>/g) || []).length;
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Align the words of the old text with the words of the new text.
 *
 * The alignment is what keeps the styling of a paragraph. A word that the
 * rewrite left alone keeps the run properties it had, so an italic "et al."
 * inside a citation stays italic, and a word that the rewrite introduced
 * takes the properties of the word before it.
 *
 * Returns { alignment, oldWords } where each alignment entry is
 * { word, source } and source is the index of the word in the old text, or
 * -1 for a word the rewrite introduced.
 */
function alignWords(oldText, newText) {
  const tokenise = (s) => s.match(/\S+\s*/g) || [];
  const a = tokenise(oldText);
  const b = tokenise(newText);
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i].trim() === b[j].trim()
        ? dp[(i + 1) * width + (j + 1)] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }
  const alignment = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].trim() === b[j].trim()) {
      alignment.push({ word: b[j], source: i });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      i++;
    } else {
      alignment.push({ word: b[j], source: -1 });
      j++;
    }
  }
  while (j < m) {
    alignment.push({ word: b[j], source: -1 });
    j++;
  }
  return { alignment, oldWords: a };
}

/**
 * Rewrite one paragraph by its full plain text.
 *
 * The paragraph must be matched exactly once. A paragraph whose runs all
 * carry the same properties is written into its first run and the rest are
 * emptied. A paragraph with mixed properties, for example a citation whose
 * "et al." is italic, is rebuilt word by word: every word that the rewrite
 * kept keeps the run properties it had, and every word it introduced takes
 * the properties of the word before it. The styling of the paragraph
 * therefore survives the rewrite.
 *
 * A paragraph that holds anything other than plain text, such as a
 * hyperlink, a field or a drawing, is refused rather than rebuilt.
 */
function rewriteParagraph(xml, oldText, newText) {
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const hits = [];

  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const paraXml = m[0];
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(paraXml)) !== null) texts.push(decodeEntities(t[1]));
    if (texts.join('') === oldText) hits.push({ index: m.index, length: m[0].length, paraXml });
  }

  if (hits.length === 0) return { ok: false, reason: 'no paragraph found with text: ' + String(oldText).slice(0, 80) };
  if (hits.length > 1) {
    return { ok: false, reason: 'paragraph text matched ' + hits.length + ' paragraphs, expected exactly 1: ' + String(oldText).slice(0, 80) };
  }

  const hit = hits[0];
  if (/<w:(hyperlink|fldSimple|instrText|bookmarkStart|drawing|pict|footnoteReference|endnoteReference|commentReference|sdt)\b/.test(hit.paraXml)) {
    return {
      ok: false,
      reason: 'paragraph holds more than plain text, refusing to rebuild it: ' + String(oldText).slice(0, 60),
    };
  }

  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let r;
  while ((r = runRe.exec(hit.paraXml)) !== null) {
    const rPrMatch = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/);
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(r[0])) !== null) texts.push(decodeEntities(t[1]));
    runs.push({
      start: r.index,
      length: r[0].length,
      xml: r[0],
      rPr: rPrMatch ? rPrMatch[0] : '',
      text: texts.join(''),
      tCount: texts.length,
    });
  }

  const props = new Set(runs.map((x) => x.rPr));

  // --- the simple case: every run carries the same properties --------------
  if (props.size <= 1) {
    let rebuilt = '';
    let cursor = 0;
    let written = false;
    for (const run of runs) {
      rebuilt += hit.paraXml.slice(cursor, run.start);
      let runXml = run.xml;
      if (run.tCount > 0) {
        if (!written) {
          runXml = runXml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/, '<w:t xml:space="preserve">' + escapeXml(newText) + '</w:t>');
          written = true;
        } else {
          runXml = runXml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, '<w:t xml:space="preserve"></w:t>');
        }
      }
      rebuilt += runXml;
      cursor = run.start + run.length;
    }
    rebuilt += hit.paraXml.slice(cursor);
    if (!written) {
      return { ok: false, reason: 'paragraph has no text run to write into: ' + String(oldText).slice(0, 60) };
    }
    const outXml = xml.slice(0, hit.index) + rebuilt + xml.slice(hit.index + hit.length);
    return { ok: true, xml: outXml, mixed: false };
  }

  // --- the mixed case: rebuild the paragraph word by word ------------------
  // Where each word of the old text lives, so that a word that survived the
  // rewrite can keep the run it came from.
  const oldWordRun = [];
  {
    const offsets = [];
    let acc = 0;
    for (const run of runs) {
      offsets.push({ start: acc, end: acc + run.text.length });
      acc += run.text.length;
    }
    const words = oldText.match(/\S+\s*/g) || [];
    let cursor = 0;
    for (const word of words) {
      const at = oldText.indexOf(word, cursor);
      if (at === -1) {
        oldWordRun.push(oldWordRun.length ? oldWordRun[oldWordRun.length - 1] : 0);
        continue;
      }
      cursor = at + word.length;
      let ri = 0;
      while (ri < offsets.length - 1 && at >= offsets[ri].end) ri++;
      oldWordRun.push(ri);
    }
  }

  const { alignment } = alignWords(oldText, newText);
  const groups = [];
  let previousRun = runs.length ? 0 : -1;
  for (const item of alignment) {
    let sourceRun;
    if (item.source >= 0 && oldWordRun[item.source] !== undefined) {
      sourceRun = oldWordRun[item.source];
    } else {
      sourceRun = previousRun;
    }
    if (sourceRun < 0 || sourceRun >= runs.length) sourceRun = 0;
    previousRun = sourceRun;
    const rPr = runs[sourceRun].rPr;
    const last = groups[groups.length - 1];
    if (last && last.rPr === rPr) {
      last.text += item.word;
    } else {
      groups.push({ rPr, text: item.word, template: sourceRun });
    }
  }

  if (!groups.length) {
    return { ok: false, reason: 'the rewrite produced no text: ' + String(oldText).slice(0, 60) };
  }

  // Rebuild the run section of the paragraph. Everything that is not a run is
  // kept exactly as it was.
  const firstStart = runs.length ? runs[0].start : hit.paraXml.length;
  const lastEnd = runs.length ? runs[runs.length - 1].start + runs[runs.length - 1].length : hit.paraXml.length;
  let runXml = '';
  for (const g of groups) {
    const template = runs[g.template] || runs[0];
    let out = template.xml;
    if (g.rPr) {
      out = out.replace(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/, g.rPr);
    }
    // The first text element carries the text, any others are emptied.
    let first = true;
    out = out.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, (t) => {
      if (first) {
        first = false;
        return '<w:t xml:space="preserve">' + escapeXml(g.text) + '</w:t>';
      }
      return '<w:t xml:space="preserve"></w:t>';
    });
    if (first) {
      out = out.replace(/<\/w:r>$/, '<w:t xml:space="preserve">' + escapeXml(g.text) + '</w:t></w:r>');
    }
    runXml += out;
  }

  const rebuilt = hit.paraXml.slice(0, firstStart) + runXml + hit.paraXml.slice(lastEnd);
  const outXml = xml.slice(0, hit.index) + rebuilt + xml.slice(hit.index + hit.length);
  return { ok: true, xml: outXml, mixed: true };
}

const args = parseArgs(process.argv.slice(2));

if (!args.input || !args.out || !args.plan) {
  console.error('Usage: node scripts/rewrite-docx.mjs <in.docx> --out <out.docx> --plan <plan.json>');
  process.exit(2);
}

let plan;
try {
  plan = JSON.parse(readFileSync(args.plan, 'utf8'));
} catch (err) {
  console.error('rewrite-docx failed: cannot read plan file: ' + err.message);
  process.exit(1);
}

const replacements = Array.isArray(plan.replace) ? plan.replace : [];
const protections = Array.isArray(plan.protect) ? plan.protect : [];

if (replacements.length === 0) {
  console.error('rewrite-docx failed: plan contains no "replace" entries');
  process.exit(1);
}

let entries;
try {
  entries = readZip(readFileSync(args.input));
} catch (err) {
  console.error('rewrite-docx failed: cannot read package: ' + err.message);
  process.exit(1);
}

const docEntry = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
if (!docEntry) {
  console.error('rewrite-docx failed: word/document.xml not found in package');
  process.exit(1);
}

const originalXml = docEntry.data.toString('utf8');
let xml = originalXml;

const failures = [];
let paragraphRewrites = 0;

// Apply each replacement, one at a time, so the match count is checked against
// the current document rather than the original.
//
// Paragraph entries come first, because a paragraph whose text is split across
// several runs cannot also be matched as a single run.
for (const item of replacements) {
  if (!item.paragraph) continue;
  const result = rewriteParagraph(xml, String(item.old), String(item.new));
  if (!result.ok) {
    failures.push(result.reason);
    continue;
  }
  xml = result.xml;
  paragraphRewrites++;
}

for (const item of replacements) {
  if (item.paragraph) continue;
  const oldText = escapeXml(String(item.old));
  const newText = escapeXml(String(item.new));

  const pattern = new RegExp('(<w:t(?:\\s[^>]*)?>)' + oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(</w:t>)', 'g');
  const matches = xml.match(pattern);

  if (!matches || matches.length === 0) {
    failures.push('no run found with text: ' + String(item.old).slice(0, 80));
    continue;
  }
  if (matches.length > 1) {
    failures.push(
      'text matched ' + matches.length + ' runs, expected exactly 1: ' + String(item.old).slice(0, 80)
    );
    continue;
  }

  xml = xml.replace(pattern, '$1' + newText + '$2');
}

if (failures.length) {
  console.error('rewrite-docx ABORTED, nothing written:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}

// Protection checks.
for (const p of protections) {
  const needle = escapeXml(String(p));
  if (!xml.includes(needle)) {
    console.error('rewrite-docx ABORTED, nothing written:');
    console.error('  - protected text was altered or lost: ' + String(p).slice(0, 80));
    process.exit(1);
  }
}

// The plain text of the rewritten document, kept so that the formatting pass
// can be proved to have changed the look of the document and not its words.
const textBeforeFormatting = plainText(xml);

// The formatting pass. Applied after the text changes so that the final
// alignment and the final spacing are the ones that ship.
//
// The six rules are applied by one module, so the justification that used to
// be a separate step is part of the same pass. The separate helper is still
// used when the formatting pass is switched off.
let formatting = null;
let justified = 0;
if (args.format) {
  formatting = applyFormatting(xml, {
    justify: args.justify,
    justifyReferences: args.justify,
  });
  xml = formatting.xml;
  justified = formatting.report.justified + formatting.report.referencesJustified;
} else if (args.justify) {
  const result = justifyDocumentXml(xml);
  xml = result.xml;
  justified = result.changed;
}

// Structural checks against the original.
const problems = [];
const expectedParagraphs =
  countParagraphs(originalXml) + (formatting ? formatting.report.coverSplit : 0);
if (countParagraphs(xml) !== expectedParagraphs) {
  problems.push('paragraph count changed');
}
if (formatting) {
  // The formatting pass is allowed to change the italic runs and the table
  // XML, because that is what it is for. The text must come out untouched.
  if (plainText(xml) !== textBeforeFormatting) {
    problems.push('the formatting pass changed the text');
  }
} else {
  if (countTags(xml, 'w:i') !== countTags(originalXml, 'w:i')) {
    problems.push('italic run count changed');
  }
  if (extractTableXml(xml) !== extractTableXml(originalXml)) {
    problems.push('table XML changed');
  }
}
if (xml.includes('\u0000')) {
  problems.push('a null sentinel leaked into the document');
}

if (problems.length) {
  console.error('rewrite-docx ABORTED, nothing written:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// Write the package: only word/document.xml changes, every other part is copied.
const out = entries.map((e) =>
  e.name.replace(/\\/g, '/') === 'word/document.xml'
    ? { name: e.name, data: Buffer.from(xml, 'utf8') }
    : { name: e.name, data: e.data }
);

writeFileSync(args.out, writeZip(out));

console.log('=== rewrite-docx report ===');
console.log('  input              : ' + args.input);
console.log('  output             : ' + args.out);
console.log('  paragraphs replaced: ' + paragraphRewrites);
console.log('  runs replaced      : ' + (replacements.length - paragraphRewrites));
console.log('  protected checks   : ' + protections.length + ' passed');
console.log('  paragraph count    : ' + countParagraphs(xml) +
  (formatting && formatting.report.coverSplit ? ' (' + formatting.report.coverSplit + ' split at the cover page break)' : ' (unchanged)'));
console.log('  package parts      : ' + out.length + ' (all preserved)');
if (formatting) {
  const r = formatting.report;
  console.log('');
  console.log('  Formatting rules applied:');
  console.log('    Rule 1  "et al." italic     : ' + r.citationsItalicised + ' paragraph(s)');
  console.log('    Rule 2  table borders        : ' + r.tables + ' table(s), ' + r.cells + ' cell(s), ' +
    r.headerCells + ' first-row cell(s) top and centred');
  console.log('    Rule 3  cover centred       : ' + r.coverParagraphs + ' paragraph(s)');
  console.log('    Rule 4  one and a half lines: ' + r.spaced + ' paragraph(s)');
  console.log('    Rule 5  references justified: ' + r.referencesJustified + ' reference(s)');
  console.log('    Rule 6  heading italic off  : ' + r.headingsDeItalicised + ' heading(s) or title(s)');
  console.log('    Body paragraphs justified  : ' + r.justified);
} else {
  console.log('  italic runs        : ' + countTags(xml, 'w:i') + ' (unchanged)');
  console.log('  table XML          : ' + (extractTableXml(xml) ? 'byte-identical' : 'no table present'));
  console.log('  alignment          : ' + (args.justify
    ? 'justified, ' + justified + ' body paragraph(s) set (headings and table cells left as they are)'
    : 'left as it was (--no-justify was used)'));
}
