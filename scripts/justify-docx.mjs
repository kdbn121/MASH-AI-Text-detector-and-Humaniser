#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// justify-docx.mjs — set a Word document to justified text.
//
//   node scripts/justify-docx.mjs <in.docx> --out <out.docx> [--include-headings]
//                                [--dry-run]
//
// Justified text spreads the space between words so that every line but the
// last reaches both margins. This is applied whatever the current alignment
// was, so a left-aligned, right-aligned or centred document comes out the
// same way.
//
// Table cells are left alone, because a cell has its own width and
// justification there reads badly. Headings, titles and captions are left
// alone by default, because a centred title stays centred in a paper that is
// otherwise justified.
//
// The script only rewrites word/document.xml. Every other part of the package
// is copied byte for byte, and the paragraph count is checked afterwards.

import { readFileSync, writeFileSync } from 'node:fs';
import { readZip, writeZip } from './lib-zip.mjs';
import { justifyDocumentXml, alignmentStats } from './lib-justify.mjs';

function parseArgs(argv) {
  const args = { input: null, out: null, includeHeadings: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--include-headings') args.includeHeadings = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  console.error('Usage: node scripts/justify-docx.mjs <in.docx> --out <out.docx> [--include-headings] [--dry-run]');
  process.exit(2);
}

let entries;
try {
  entries = readZip(readFileSync(args.input));
} catch (err) {
  console.error('justify-docx failed: cannot read package: ' + err.message);
  process.exit(1);
}

const docEntry = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
if (!docEntry) {
  console.error('justify-docx failed: word/document.xml not found in package');
  process.exit(1);
}

const originalXml = docEntry.data.toString('utf8');
const before = alignmentStats(originalXml);

const result = justifyDocumentXml(originalXml, { includeHeadings: args.includeHeadings });
const after = alignmentStats(result.xml);

const paragraphsBefore = countParagraphs(originalXml);
const paragraphsAfter = countParagraphs(result.xml);
if (paragraphsBefore !== paragraphsAfter) {
  console.error('justify-docx ABORTED, nothing written: paragraph count changed');
  process.exit(1);
}

if (result.xml.includes('\u0000')) {
  console.error('justify-docx ABORTED, nothing written: a null sentinel leaked into the document');
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

function countParagraphs(xml) {
  return (xml.match(/<w:p\b[^>]*>/g) || []).length;
}

console.log('=== justify-docx report ===');
console.log('  input            : ' + args.input);
console.log('  output           : ' + (args.out || '(dry run, nothing written)'));
console.log('  body paragraphs  : ' + before.paragraphs);
console.log('  paragraphs set   : ' + result.changed);
console.log('  alignment before : ' + formatCounts(before.counts));
console.log('  alignment after  : ' + formatCounts(after.counts));
console.log('  headings         : ' + (args.includeHeadings ? 'also justified' : 'left as they are'));
console.log('  table cells      : left as they are');
console.log('  package parts    : ' + entries.length + ' (all preserved)');
console.log('  Review the result before using it. Justified text can open up wide gaps in a narrow column.');

function formatCounts(counts) {
  const keys = Object.keys(counts);
  if (!keys.length) return 'none';
  return keys.map((k) => k + '=' + counts[k]).join(', ');
}
