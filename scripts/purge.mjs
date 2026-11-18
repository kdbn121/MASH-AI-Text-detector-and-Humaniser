#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// purge.mjs — strip invisible tracking Unicode and C2PA content credentials.
//
//   node scripts/purge.mjs <file> [--out <file>] [--dry-run] [--keep-meta]
//
// Text formats (.txt, .md, .tex, .csv, .json): invisible Unicode removed, file rewritten.
// .docx: invisible Unicode removed from every XML part, C2PA manifest parts and their
// relationships removed, author metadata blanked unless --keep-meta is passed.
//
// Writes to <file>.purged.<ext> when --out is not given. Never overwrites the input.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extname, basename, dirname, join } from 'node:path';
import { readZip, writeZip } from './lib-zip.mjs';
import { INVISIBLE_PATTERN } from './lib-text.mjs';

const C2PA_MARKERS = ['c2pa', 'contentcredentials', 'content credentials', 'c2pa-manifest'];

function isC2paPart(name, text) {
  if (!/^customXml\//i.test(name)) return false;
  const lower = text.toLowerCase();
  return C2PA_MARKERS.some((m) => lower.includes(m));
}

function stripInvisible(text) {
  return text.replace(INVISIBLE_PATTERN, '');
}

function purgeDocx(buf, opts) {
  const entries = readZip(buf);
  const report = {
    invisibleRemoved: 0,
    partsPurged: [],
    relationshipsRemoved: 0,
    contentTypesCleaned: 0,
    metadataBlanked: false,
  };

  const dropped = new Set();
  const keptCustomXml = [];
  const purgedParts = [];

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    if (!/^customXml\//i.test(name)) continue;
    const text = entry.data.toString('utf8');
    if (isC2paPart(name, text)) {
      dropped.add(name);
      purgedParts.push(name);
    } else {
      keptCustomXml.push(name);
    }
  }

  // An item-properties part and an item's rels part belong to their item part.
  // Drop them only when the item they describe was dropped, so unrelated
  // custom XML survives untouched.
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    const props = name.match(/^customXml\/itemProps(\d*)\.xml$/i);
    const rels = name.match(/^customXml\/_rels\/item(\d*)\.xml\.rels$/i);
    const itemNumber = props ? props[1] : rels ? rels[1] : null;
    if (itemNumber !== null && dropped.has(`customXml/item${itemNumber}.xml`)) {
      dropped.add(name);
      purgedParts.push(name);
    }
  }

  report.partsPurged = [...new Set(purgedParts)];

  const droppedBases = new Set([...dropped].map((n) => basename(n)));

  const out = [];
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    if (dropped.has(name)) continue;

    // Relationship parts end in .rels, content and document parts end in .xml.
    // Both need the invisible-character scrub and, for .rels, link cleanup.
    const lower = name.toLowerCase();
    if (lower.endsWith('.xml') || lower.endsWith('.rels')) {
      let text = entry.data.toString('utf8');

      // 1. invisible Unicode everywhere
      const cleaned = stripInvisible(text);
      if (cleaned !== text) {
        report.invisibleRemoved += (text.match(INVISIBLE_PATTERN) || []).length;
        text = cleaned;
      }

      // 2. content types: remove overrides for dropped parts
      if (name === '[Content_Types].xml' && dropped.size) {
        const before = text;
        text = text.replace(/<Override\b[^>]*\/>/g, (tag) => {
          const m = tag.match(/PartName="\/([^"]+)"/);
          if (m && droppedBases.has(basename(m[1]))) {
            report.contentTypesCleaned++;
            return '';
          }
          return tag;
        });
        if (before !== text) entry.data = Buffer.from(text, 'utf8');
      }

      // 3. relationships: remove links to dropped parts
      if (/_rels\/[^/]+\.rels$/i.test(name) && dropped.size) {
        const before = text;
        text = text.replace(/<Relationship\b[^>]*\/>/g, (tag) => {
          const m = tag.match(/Target="([^"]+)"/);
          if (m && /customXml/i.test(m[1]) && droppedBases.has(basename(m[1]))) {
            report.relationshipsRemoved++;
            return '';
          }
          return tag;
        });
        if (before !== text) entry.data = Buffer.from(text, 'utf8');
      }

      // 4. core properties: blank authorship metadata
      if (name === 'docProps/core.xml' && !opts.keepMeta) {
        const before = text;
        text = text.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/, '<dc:creator></dc:creator>');
        text = text.replace(
          /<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/,
          '<cp:lastModifiedBy></cp:lastModifiedBy>'
        );
        if (before !== text) {
          report.metadataBlanked = true;
          entry.data = Buffer.from(text, 'utf8');
        }
      }

      entry.data = Buffer.from(text, 'utf8');
    }

    out.push({ name: entry.name, data: entry.data });
  }

  report.keptCustomXml = keptCustomXml.filter((n) => !dropped.has(n));
  return { entries: out, report };
}

function parseArgs(argv) {
  const args = { file: null, out: null, dryRun: false, keepMeta: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep-meta') args.keepMeta = true;
    else if (!a.startsWith('-') && !args.file) args.file = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  console.error('Usage: node scripts/purge.mjs <file> [--out <file>] [--dry-run] [--keep-meta]');
  process.exit(2);
}

if (!existsSync(args.file)) {
  console.error('purge failed: file not found: ' + args.file);
  process.exit(1);
}

const ext = extname(args.file).toLowerCase();
const outPath =
  args.out ||
  join(dirname(args.file), basename(args.file, extname(args.file)) + '.purged' + extname(args.file));

try {
  if (ext === '.docx') {
    const buf = readFileSync(args.file);
    const { entries, report } = purgeDocx(buf, args);
    console.log('=== Purge report: ' + basename(args.file) + ' ===');
    console.log('  invisible characters removed : ' + report.invisibleRemoved);
    console.log('  C2PA parts removed           : ' + (report.partsPurged.length ? report.partsPurged.join(', ') : 'none found'));
    console.log('  relationships removed        : ' + report.relationshipsRemoved);
    console.log('  content-type overrides fixed : ' + report.contentTypesCleaned);
    console.log('  authorship metadata blanked  : ' + (report.metadataBlanked ? 'yes' : 'no'));
    if (report.keptCustomXml && report.keptCustomXml.length) {
      console.log('  customXml parts kept (not C2PA): ' + report.keptCustomXml.join(', '));
    }
    if (!args.dryRun) {
      writeFileSync(outPath, writeZip(entries));
      console.log('  written                      : ' + outPath);
    } else {
      console.log('  dry run, nothing written');
    }
  } else {
    const text = readFileSync(args.file, 'utf8');
    const cleaned = stripInvisible(text);
    const removed = (text.match(INVISIBLE_PATTERN) || []).length;
    console.log('=== Purge report: ' + basename(args.file) + ' ===');
    console.log('  invisible characters removed : ' + removed);
    if (!args.dryRun) {
      writeFileSync(outPath, cleaned, 'utf8');
      console.log('  written                      : ' + outPath);
    } else {
      console.log('  dry run, nothing written');
    }
  }
} catch (err) {
  console.error('purge failed: ' + err.message);
  process.exit(1);
}
