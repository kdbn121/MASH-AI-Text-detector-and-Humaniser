#!/usr/bin/env node
// format-citations.mjs -- put the citations of a document into one style.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// WHAT THIS SCRIPT DOES
//
// It applies the rules of one named style to the citations of a document:
//
//   1  the abbreviation goes in italic or in roman, as the style asks
//   2  a comma is put between the name and the year inside brackets, as the
//      style asks
//   3  nothing else is touched
//
// WHAT THIS SCRIPT REFUSES TO DO
//
// It will not run without a style. There is no default, because the default
// would be a guess, and a guess about a citation style is a guess about the
// journal.
//
// It will not invent a reference, a DOI or a link. A citation with no entry
// in the reference list is left exactly as it is and reported by
// audit-citations.mjs, because the only person who can supply the missing
// source is the writer.
//
// It will not renumber a numeric reference list. Renumbering means changing
// the numbers in the body as well, and a mistake there is a mistake in the
// meaning. The order is reported and left to the writer.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip, writeZip } from './lib-zip.mjs';
import { classifySequence, extractGuardRecords } from './lib-guard.mjs';
import { italiciseEtAl, splitRun } from './lib-format.mjs';
import { loadStyleBank } from './lib-citations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = join(HERE, '..', 'rules');

function parseArgs(argv) {
  const args = { file: null, out: null, style: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--style') args.style = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (!a.startsWith('-') && !args.file) args.file = a;
  }
  return args;
}

function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Insert a comma at the places where the style wants one.
 *
 * The pattern is a name, a space and a four digit year inside brackets, with
 * no comma between them. The comma is inserted by splitting the run it falls
 * in, so the rest of the paragraph keeps its formatting.
 */
function insertCommaBeforeYear(para) {
  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runRe.exec(para)) !== null) {
    const tMatch = m[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    const rPrMatch = m[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/);
    runs.push({
      start: m.index,
      length: m[0].length,
      xml: m[0],
      rPr: rPrMatch ? rPrMatch[0] : '',
      text: tMatch ? decodeEntities(tMatch[1]) : null,
    });
  }
  const textRuns = runs.filter((r) => r.text !== null);
  if (!textRuns.length) return { xml: para, count: 0 };

  let offset = 0;
  const map = [];
  for (const run of textRuns) {
    map.push({ run, start: offset, end: offset + run.text.length });
    offset += run.text.length;
  }
  const full = map.map((x) => x.run.text).join('');

  // A bracket, a name, a space and a year, with no comma between them.
  const points = [];
  const re = /\(\s*[A-Z][A-Za-z'’\-]*(?:\s+et\s+al\.)?\s+(\d{4}[a-z]?)/g;
  let hit;
  while ((hit = re.exec(full)) !== null) {
    points.push(hit.index + hit[0].length - hit[1].length);
  }
  if (!points.length) return { xml: para, count: 0 };

  const replacements = [];
  for (const entry of map) {
    const r = entry.run;
    const boundaries = new Set([0, r.text.length]);
    for (const at of points) {
      if (at > entry.start && at < entry.end) {
        boundaries.add(at - entry.start);
      }
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    if (ordered.length < 2) continue;
    const segments = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      if (to <= from) continue;
      const absolute = entry.start + from;
      segments.push({
        text: r.text.slice(from, to),
        props: r.rPr,
        italic: false,
        commaBefore: points.includes(absolute),
      });
    }
    if (!segments.length) continue;

    // The comma is added by building the run text by hand, so that the run
    // that holds it is a run of its own.
    let rebuilt = '';
    for (const s of segments) {
      const open = r.xml.match(/^<w:r\b[^>]*>/);
      if (!open) { rebuilt += r.xml; continue; }
      let text = s.text;
      if (s.commaBefore) text = ',' + text;
      rebuilt += open[0] + (s.props || '') +
        '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r>';
    }
    if (rebuilt !== r.xml) replacements.push({ start: r.start, length: r.length, text: rebuilt });
  }
  if (!replacements.length) return { xml: para, count: 0 };

  let out = '';
  let cursor = 0;
  for (const rep of replacements) {
    out += para.slice(cursor, rep.start) + rep.text;
    cursor = rep.start + rep.length;
  }
  out += para.slice(cursor);
  return { xml: out, count: points.length };
}

/** Apply the style to one document part. */
function applyStyle(xml, style) {
  const report = { etAlChanged: 0, commasAdded: 0, paragraphs: 0 };
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const edits = [];
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    let next = m[0];
    const before = next;

    const italic = italiciseEtAl(next, style.etaItalic);
    if (italic !== next) {
      report.etAlChanged++;
      next = italic;
    }
    if (style.commaBeforeYear) {
      const comma = insertCommaBeforeYear(next);
      if (comma.count) {
        report.commasAdded += comma.count;
        next = comma.xml;
      }
    }
    if (next !== before) {
      edits.push({ start: m.index, length: m[0].length, text: next });
      report.paragraphs++;
    }
  }
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    xml = xml.slice(0, e.start) + e.text + xml.slice(e.start + e.length);
  }
  return { xml, report };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node scripts/format-citations.mjs <in.docx> --out <out.docx> --style <style> [--dry-run]');
    process.exit(2);
  }

  const bank = loadStyleBank(RULES);
  if (!args.style) {
    console.error('No style was named, and this script has no default.');
    console.error('Choose the style your journal asks for:');
    for (const name of bank.names) {
      console.error('  ' + name.padEnd(14) + bank.styles[name].label);
    }
    process.exit(2);
  }
  const style = bank.get(args.style);
  if (!style) {
    console.error('The style "' + args.style + '" is not in the bank.');
    console.error('Choose one of:');
    for (const name of bank.names) {
      console.error('  ' + name.padEnd(14) + bank.styles[name].label);
    }
    process.exit(2);
  }

  const entries = readZip(readFileSync(args.file));
  const docIndex = entries.findIndex((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
  if (docIndex === -1) throw new Error('the file has no word/document.xml part');
  const xml = entries[docIndex].data.toString('utf8');

  const { xml: outXml, report } = applyStyle(xml, style);

  console.log('=== citation style applied ===');
  console.log('  file          : ' + args.file);
  console.log('  style         : ' + style.label + ' (' + style.key + ')');
  console.log('  abbreviation  : ' + (style.etaItalic ? 'italic' : 'roman'));
  console.log('  comma before  : ' + (style.commaBeforeYear ? 'yes' : 'no'));
  console.log('  paragraphs    : ' + report.paragraphs + ' changed');
  console.log('  abbreviation  : ' + report.etAlChanged + ' paragraph(s) with "et al."');
  console.log('  commas added  : ' + report.commasAdded);
  console.log('');

  if (args.dryRun) {
    console.log('Dry run, nothing written.');
    return;
  }
  if (!args.out) {
    console.error('No output file was named. Use --out <file>.');
    process.exit(2);
  }

  entries[docIndex].data = Buffer.from(outXml, 'utf8');
  writeFileSync(args.out, writeZip(entries));
  console.log('  written       : ' + args.out);
  console.log('');
  console.log('No citation, reference, DOI or link was invented, and no reference list was');
  console.log('renumbered. Run audit-citations.mjs on the result to see what still needs a');
  console.log('writer: a missing reference and a placeholder entry are both left as they are,');
  console.log('because only the writer can supply them.');
}

main();
