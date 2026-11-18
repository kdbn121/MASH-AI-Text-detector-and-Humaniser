#!/usr/bin/env node
// audit-citations.mjs -- check the citations of a document against its
// reference list, its links and one style guide.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// WHAT THIS SCRIPT DOES
//
//   1  reads every in-text citation out of the document
//   2  reads every entry of the reference list out of the document
//   3  matches one against the other and reports what does not line up
//   4  checks every DOI and every link
//   5  checks the result against the rules of the style the user names
//
// WHAT THIS SCRIPT WILL NOT DO
//
// It will not invent a missing reference. It will not write a DOI it has not
// read from the document. It will not guess a link.
//
// A missing reference is reported as missing, with the citation that needs
// it, so that the writer can supply it. A link that does not resolve is
// reported as not resolving, with the address, so that the writer can
// decide whether to replace it.
//
// The link check is a check of syntax. The network check is a separate,
// optional step, because a machine that quietly phones home on every run is
// a machine nobody trusts with a manuscript.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib-zip.mjs';
import { extractText } from './lib-text.mjs';
import { classifySequence, extractGuardRecords } from './lib-guard.mjs';
import {
  authorDateKey,
  crossCheck,
  extractDoi,
  extractUrl,
  findEtAlFormatting,
  loadStyleBank,
  parseCitations,
  parseNumericCitations,
  parseReference,
  styleViolations,
  validateDoi,
  validateUrl,
} from './lib-citations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = join(HERE, '..', 'rules');

function parseArgs(argv) {
  const args = { file: null, style: null, json: false, resolve: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--style') args.style = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--resolve') args.resolve = true;
    else if (!a.startsWith('-') && !args.file) args.file = a;
  }
  return args;
}

/** The paragraphs of a document, with the text of each one. */
function documentParagraphs(file) {
  if (file.toLowerCase().endsWith('.docx')) {
    const entries = readZip(readFileSync(file));
    const doc = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
    if (!doc) throw new Error('the file has no word/document.xml part');
    const xml = doc.data.toString('utf8');
    const records = extractGuardRecords(xml);
    const kinds = classifySequence(records);
    return {
      xml,
      paragraphs: records.map((r, i) => ({ text: r.text || '', kind: kinds[i] })),
    };
  }
  const { text } = extractText(file);
  const parts = text.split(/\n{2,}/);
  let inReferences = false;
  const paragraphs = parts.map((p) => {
    const trimmed = p.trim();
    if (/^(references|bibliography|works cited|literature cited)\s*$/i.test(trimmed)) {
      inReferences = true;
      return { text: trimmed, kind: 'heading' };
    }
    const kind = inReferences ? 'reference' : 'prose';
    return { text: trimmed, kind };
  });
  return { xml: null, paragraphs };
}

/** The reference list of a document, as a list of raw entries. */
function referenceEntries(paragraphs) {
  const entries = [];
  for (const p of paragraphs) {
    if (p.kind !== 'reference') continue;
    const text = p.text.trim();
    if (!text) continue;
    entries.push(text);
  }
  return entries;
}

/**
 * The network check.
 *
 * A DOI is asked for at doi.org and a link at its own host. The status code
 * is read and nothing else. Nothing is downloaded into the document and no
 * answer is invented.
 */
async function resolveLinks(items) {
  if (typeof fetch !== 'function') {
    return { available: false, reason: 'this build of Node has no fetch, so the network check cannot run' };
  }
  const results = [];
  for (const item of items) {
    const target = item.doi
      ? 'https://doi.org/' + item.doi
      : item.url;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const response = await fetch(target, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'Plagiarism-minimiser-KDBN/1.7 (citation link check)' },
      });
      clearTimeout(timer);
      results.push({ ...item, status: response.status, ok: response.status >= 200 && response.status < 400 });
    } catch (err) {
      results.push({ ...item, status: null, ok: false, error: String(err && err.message ? err.message : err) });
    }
  }
  return { available: true, results };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node scripts/audit-citations.mjs <file> --style <style> [--json] [--resolve]');
    process.exit(2);
  }

  const bank = loadStyleBank(RULES);
  const style = bank.get(args.style);
  if (!style) {
    console.error('The style "' + args.style + '" is not in the bank.');
    console.error('Choose one of:');
    for (const name of bank.names) {
      console.error('  ' + name.padEnd(14) + bank.styles[name].label);
    }
    process.exit(2);
  }

  const { xml, paragraphs } = documentParagraphs(args.file);
  const prose = paragraphs.filter((p) => p.kind === 'prose');
  const bodyText = prose.map((p) => p.text).join('\n\n');
  const references = referenceEntries(paragraphs).map((raw, i) => parseReference(raw, i)).filter(Boolean);

  const citations = style.family === 'numeric'
    ? parseNumericCitations(bodyText)
    : parseCitations(bodyText);

  const { missing, unused } = crossCheck(citations, references, style);

  // The reference map, so that the style rules can look up the entry a
  // citation points at.
  const referenceMap = new Map();
  for (const ref of references) {
    if (ref.surname && ref.year) {
      const key = authorDateKey(ref.surname, ref.year);
      if (!referenceMap.has(key)) referenceMap.set(key, ref);
    }
  }

  const problems = styleViolations(citations, references, style, referenceMap);

  // The links. A DOI inside a doi.org address is counted once.
  const linkItems = [];
  const seen = new Set();
  for (const ref of references) {
    const dois = extractDoi(ref.raw);
    const urls = extractUrl(ref.raw);
    for (const d of dois) {
      const key = 'doi:' + d.doi;
      if (seen.has(key)) continue;
      seen.add(key);
      const check = validateDoi(d.doi);
      linkItems.push({ kind: 'doi', doi: check.ok ? check.doi : d.doi, raw: d.doi, ok: check.ok, reason: check.reason, reference: ref });
    }
    for (const u of urls) {
      const inside = /doi\.org\//i.test(u.url);
      const key = 'url:' + u.url;
      if (seen.has(key)) continue;
      seen.add(key);
      if (inside) continue;
      const check = validateUrl(u.url);
      linkItems.push({ kind: 'url', url: check.ok ? check.url : u.url, raw: u.url, ok: check.ok, reason: check.reason, reference: ref });
    }
  }

  const etAl = xml ? findEtAlFormatting(xml) : [];
  const etAlItalic = etAl.filter((e) => e.italic).length;
  const etAlRoman = etAl.filter((e) => !e.italic).length;
  const etAlWrong = style.etaItalic
    ? etAl.filter((e) => !e.italic)
    : etAl.filter((e) => e.italic);

  const report = {
    file: args.file,
    style: { key: style.key, label: style.label, family: style.family },
    counts: {
      paragraphs: paragraphs.length,
      inTextCitations: citations.length,
      referenceEntries: references.length,
      links: linkItems.length,
      etAlOccurrences: etAl.length,
    },
    missing,
    unused,
    problems,
    links: linkItems,
    etAl: { total: etAl.length, italic: etAlItalic, roman: etAlRoman, wrong: etAlWrong.length },
    note: 'No similarity or detection score can be guaranteed, and no citation or link is ever invented by this script.',
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('=== citation and reference audit ===');
  console.log('  file        : ' + args.file);
  console.log('  style       : ' + style.label + ' (' + style.key + ')');
  console.log('  citations   : ' + citations.length + ' in the body');
  console.log('  references  : ' + references.length + ' in the list');
  console.log('');

  console.log('1. Cross-check anomalies');
  if (!missing.length && !unused.length) {
    console.log('   CLEAN - every citation has an entry and every entry is cited');
  }
  if (missing.length) {
    console.log('   MISSING REFERENCE (' + missing.length + ')');
    for (const m of missing.slice(0, 40)) {
      console.log('     - "' + String(m.citation.raw || m.citation.text).trim().slice(0, 110) + '"  ->  ' + m.reason);
    }
    if (missing.length > 40) console.log('     ... and ' + (missing.length - 40) + ' more');
  }
  if (unused.length) {
    console.log('   UNUSED REFERENCE (' + unused.length + ')');
    for (const u of unused.slice(0, 40)) {
      console.log('     - ' + String(u.raw).slice(0, 120));
    }
    if (unused.length > 40) console.log('     ... and ' + (unused.length - 40) + ' more');
  }
  console.log('');

  console.log('2. Link and DOI integrity');
  if (!linkItems.length) {
    console.log('   NO LINK FOUND - the reference list holds no DOI and no address');
  } else {
    const bad = linkItems.filter((l) => !l.ok);
    console.log('   ' + linkItems.length + ' link(s), ' + bad.length + ' malformed');
    for (const l of linkItems.slice(0, 40)) {
      console.log('     ' + (l.ok ? 'OK  ' : 'BAD ') + l.kind + '  ' + l.raw.slice(0, 90) + (l.ok ? '' : '   -> ' + l.reason));
    }
    if (linkItems.length > 40) console.log('     ... and ' + (linkItems.length - 40) + ' more');
  }
  console.log('');

  console.log('3. Style rule violations');
  if (!problems.length) {
    console.log('   CLEAN - the citations follow the ' + style.label + ' rules');
  } else {
    for (const p of problems.slice(0, 40)) {
      console.log('     ' + (p.severity === 'error' ? 'ERROR' : 'warn ') + '  ' + p.message);
      if (p.citation) console.log('            at "' + String(p.citation.raw || p.citation.text).trim().slice(0, 100) + '"');
      if (p.reference) console.log('            in "' + String(p.reference.raw).slice(0, 100) + '"');
    }
    if (problems.length > 40) console.log('     ... and ' + (problems.length - 40) + ' more');
  }
  console.log('');

  console.log('4. The abbreviation');
  console.log('   ' + etAl.length + ' occurrence(s): ' + etAlItalic + ' italic, ' + etAlRoman + ' roman');
  console.log('   the style asks for ' + (style.etaItalic ? 'italic' : 'roman'));
  if (etAlWrong.length) {
    console.log('   ' + etAlWrong.length + ' occurrence(s) are in the wrong style');
  } else {
    console.log('   every occurrence is in the right style');
  }
  console.log('');
  console.log('Note: no citation, reference, DOI or link is invented by this script, and no');
  console.log('      detection score can be guaranteed. The network check is a separate,');
  console.log('      optional step and is never run unless it is asked for.');
}

main();
