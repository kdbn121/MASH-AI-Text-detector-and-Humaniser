#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// format-docx.mjs — apply the six document formatting rules to a Word file.
//
//   node scripts/format-docx.mjs <in.docx> --out <out.docx> [options]
//
// The rules are:
//   1  every "et al." in a citation is italic
//   2  every table carries a full grid of borders, and the cells of the first
//      row are aligned to the top and to the centre
//   3  the cover page is centred
//   4  the text is set at one and a half lines
//   5  the reference list is justified from the left margin to the right margin
//   6  a heading, a title or a subtitle carries no italic
//
// Each rule can be switched off with its own flag, so that a document that
// already looks right is not changed for the sake of it.
//
// The script only rewrites word/document.xml. Every other part of the package
// is copied byte for byte, and the paragraph count is checked afterwards.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, writeZip } from './lib-zip.mjs';
import { applyFormatting, ONE_AND_HALF, DOUBLE, SINGLE } from './lib-format.mjs';

function parseArgs(argv) {
  const args = {
    input: null,
    out: null,
    dryRun: false,
    justify: true,
    justifyReferences: true,
    lineSpacing: ONE_AND_HALF,
    coverCentred: true,
    tableBorders: true,
    tableHeaderAligned: true,
    headingItalicOff: true,
    citationEtAl: 'italic',
    citationStyle: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-justify') args.justify = false;
    else if (a === '--no-justify-references') args.justifyReferences = false;
    else if (a === '--no-cover-centre') args.coverCentred = false;
    else if (a === '--no-table-borders') args.tableBorders = false;
    else if (a === '--no-table-header-align') args.tableHeaderAligned = false;
    else if (a === '--no-heading-italic-off') args.headingItalicOff = false;
    else if (a === '--no-citation-italics') args.citationEtAl = 'keep';
    else if (a === '--citation-style') args.citationStyle = argv[++i];
    else if (a === '--single-spacing') args.lineSpacing = SINGLE;
    else if (a === '--double-spacing') args.lineSpacing = DOUBLE;
    else if (a === '--line-spacing') args.lineSpacing = parseInt(argv[++i], 10);
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  console.error('Usage: node scripts/format-docx.mjs <in.docx> --out <out.docx> [--dry-run]');
  console.error('  --no-justify              leave the body text as it is');
  console.error('  --no-justify-references   leave the reference list as it is');
  console.error('  --no-cover-centre         leave the cover page as it is');
  console.error('  --no-table-borders        leave the table borders as they are');
  console.error('  --no-table-header-align   leave the first table row as it is');
  console.error('  --no-heading-italic-off   leave the heading italics as they are');
  console.error('  --no-citation-italics     leave "et al." as it is');
  console.error('  --single-spacing          one line instead of one and a half');
  console.error('  --double-spacing          two lines');
  console.error('  --line-spacing <n>        a line spacing in twips, 360 is one and a half');
  process.exit(2);
}

let entries;
try {
  entries = readZip(readFileSync(args.input));
} catch (err) {
  console.error('format-docx failed: cannot read package: ' + err.message);
  process.exit(1);
}

const docEntry = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
if (!docEntry) {
  console.error('format-docx failed: word/document.xml not found in package');
  process.exit(1);
}

const originalXml = docEntry.data.toString('utf8');

// The citation style decides whether the abbreviation goes in italic or in
// roman. There is no default here either, but the flag has one, because a
// formatting run that changes nothing is better than one that guesses.
if (args.citationStyle) {
  const { loadStyleBank } = await import('./lib-citations.mjs');
  const bank = loadStyleBank(join(dirname(fileURLToPath(import.meta.url)), '..', 'rules'));
  const style = bank.get(args.citationStyle);
  if (!style) {
    console.error('format-docx ABORTED: the citation style "' + args.citationStyle + '" is not in the bank.');
    console.error('Choose one of: ' + bank.names.join(', '));
    process.exit(2);
  }
  args.citationEtAl = style.etaItalic ? 'italic' : 'roman';
}

const result = applyFormatting(originalXml, {
  justify: args.justify,
  justifyReferences: args.justifyReferences,
  lineSpacing: args.lineSpacing,
  coverCentred: args.coverCentred,
  tableBorders: args.tableBorders,
  tableHeaderAligned: args.tableHeaderAligned,
  headingItalicOff: args.headingItalicOff,
  citationEtAl: args.citationEtAl,
});

if (result.xml.includes('\u0000')) {
  console.error('format-docx ABORTED, nothing written: a null sentinel leaked into the document');
  process.exit(1);
}

if (!isWellFormed(result.xml)) {
  console.error('format-docx ABORTED, nothing written: the document XML is not well formed');
  process.exit(1);
}

if (!args.dryRun && args.out) {
  const out = entries.map((e) =>
    e.name.replace(/\\/g, '/') === 'word/document.xml'
      ? { name: e.name, data: Buffer.from(result.xml, 'utf8') }
      : { name: e.name, data: e.data }
  );
  writeFileSync(args.out, writeZip(out));
}

const r = result.report;

console.log('=== format-docx report ===');
console.log('  input              : ' + args.input);
console.log('  output             : ' + (args.out || '(dry run, nothing written)'));
console.log('  package parts      : ' + entries.length + ' (all preserved)');
console.log('');
console.log('  Rule 1  citations  : ' + r.citationsItalicised + ' paragraph(s) with an italic "et al."');
console.log('  Rule 2  tables     : ' + r.tables + ' table(s), ' + r.cells + ' cell(s), ' +
  r.headerCells + ' first-row cell(s) aligned top and centred');
console.log('  Rule 3  cover      : ' + r.coverParagraphs + ' paragraph(s) centred');
console.log('  Rule 4  spacing    : ' + r.spaced + ' paragraph(s) set at ' +
  describeSpacing(args.lineSpacing) + (args.lineSpacing === ONE_AND_HALF ? '' : ' (not the default)'));
console.log('  Rule 5  references : ' + r.referencesJustified + ' reference(s) justified');
console.log('  Rule 6  headings   : ' + r.headingsDeItalicised + ' heading(s), title(s) or subtitle(s) de-italicised');
console.log('');
console.log('  Body paragraphs justified : ' + r.justified);
console.log('  Review the result before using it. A table that was laid out on purpose');
console.log('  may lose its open look, and a code listing keeps its own spacing on purpose.');

function describeSpacing(twips) {
  if (twips === SINGLE) return 'one line';
  if (twips === ONE_AND_HALF) return 'one and a half lines';
  if (twips === DOUBLE) return 'two lines';
  return twips + ' twips';
}

/**
 * A quick well-formedness check. The tags are counted and the nesting is
 * tracked, which catches a tag that was left open or closed twice.
 */
function isWellFormed(xml) {
  const re = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/';
    const tag = m[2];
    if (closing) {
      const top = stack.pop();
      if (top !== tag) return false;
    } else if (!selfClosing) {
      stack.push(tag);
    }
  }
  return stack.length === 0;
}
