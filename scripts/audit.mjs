#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// audit.mjs — measure similarity risk and AI-detector-visible style signals.
//
//   node scripts/audit.mjs <file> [--source <file>] [--k 5] [--json]
//
// Reports:
//   1. residual matched chains against the source (similarity risk)
//   2. invisible / tracking Unicode
//   3. sentence-length variation (burstiness)
//   4. lexical diversity (TTR and MATTR)
//   5. discourse-marker repetition
//   6. trigger-phrase hits
//
// Exit code 0 always, unless the file cannot be read. Use --json for machine use.

import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { readZip } from './lib-zip.mjs';
import { alignmentStats } from './lib-justify.mjs';
import {
  extractText,
  tokenize,
  tokenStrings,
  sharedChains,
  burstiness,
  ttr,
  mattr,
  findInvisible,
  countPhrases,
  TRIGGER_PHRASES,
  DISCOURSE_MARKERS,
  displayPath,
} from './lib-text.mjs';

function parseArgs(argv) {
  const args = { file: null, source: null, k: 5, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--k') args.k = parseInt(argv[++i], 10) || 5;
    else if (a === '--json') args.json = true;
    else if (!a.startsWith('-') && !args.file) args.file = a;
  }
  return args;
}

function verdict(label, level, detail) {
  return { label, level, detail };
}

/**
 * Read the paragraph alignment of a Word document.
 * Returns null for anything that is not a .docx package.
 */
function docxAlignment(filePath, format) {
  if (format !== 'docx') return null;
  try {
    const entries = readZip(readFileSync(filePath));
    const doc = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
    if (!doc) return null;
    return alignmentStats(doc.data.toString('utf8'));
  } catch (err) {
    return null;
  }
}

/**
 * Compression entropy.
 *
 * Text that repeats the same words in the same order compresses well, so the
 * compressed size relative to the raw size is a rough measure of how
 * predictable the prose is. The Shannon entropy of the character distribution
 * says the same thing from the other side.
 *
 * This is a repeatability proxy, not a detector. Human writing can score low
 * and machine writing can score high.
 */
function compressionEntropy(text) {
  const raw = Buffer.from(text, 'utf8');
  const compressed = gzipSync(raw, { level: 9 });
  const ratio = raw.length ? compressed.length / raw.length : 0;

  const freq = new Map();
  for (const ch of text) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  const n = text.length;
  if (n) {
    for (const count of freq.values()) {
      const p = count / n;
      entropy -= p * Math.log2(p);
    }
  }

  return {
    entropyBitsPerChar: Math.round(entropy * 1000) / 1000,
    compressedRatio: Math.round(ratio * 1000) / 1000,
    rawBytes: raw.length,
    compressedBytes: compressed.length,
  };
}

function audit(targetPath, sourcePath, k) {
  const doc = extractText(targetPath);
  const tokens = tokenize(doc.text);
  const tokenList = tokens.map((t) => t.token);

  const report = {
    file: targetPath,
    format: doc.format,
    words: tokenList.length,
    source: sourcePath || null,
    sections: [],
  };

  // 1. similarity chains -----------------------------------------------------
  if (sourcePath) {
    if (!existsSync(sourcePath)) {
      report.sections.push({
        title: '1. Similarity risk against source',
        verdict: verdict('SOURCE NOT FOUND', 'error', sourcePath),
        items: [],
      });
    } else {
      const src = extractText(sourcePath);
      const srcTokens = tokenStrings(src.text);
      const chains = sharedChains(tokenList, srcTokens, k);
      const overlapping = chains.reduce((sum, c) => sum + c.len, 0);
      const guaranteed = chains.filter((c) => c.len >= k + 3); // 8 words at k=5
      const pct = tokenList.length ? (overlapping / tokenList.length) * 100 : 0;

      let level = 'ok';
      let detail = 'no matched chains of ' + k + ' words or more';
      if (guaranteed.length > 0) {
        level = 'bad';
        detail =
          guaranteed.length +
          ' chain(s) of 8 words or more, which are essentially always matched';
      } else if (chains.length > 0) {
        level = 'warn';
        detail = chains.length + ' chain(s) of ' + k + ' words or more, none yet at the 8-word threshold';
      }

      report.sections.push({
        title: '1. Similarity risk against source',
        verdict: verdict(level === 'ok' ? 'CLEAR' : level === 'warn' ? 'REVIEW' : 'HIGH RISK', level, detail),
        stats: {
          chains: chains.length,
          guaranteedChains: guaranteed.length,
          overlappingWords: overlapping,
          estimatedSimilarityPct: Math.round(pct * 10) / 10,
          sourceWords: srcTokens.length,
        },
        items: chains
          .map((c) => {
            const first = tokens[c.startA];
            const last = tokens[c.startA + c.len - 1];
            const slice = first && last ? doc.text.slice(first.start, last.end) : c.text;
            return {
              words: c.len,
              text: slice.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' | ').trim(),
              offsetChar: first ? first.start : 0,
              threshold: c.len >= k + 3,
            };
          })
          .sort((a, b) => Number(b.threshold) - Number(a.threshold) || b.words - a.words),
      });
    }
  } else {
    report.sections.push({
      title: '1. Similarity risk against source',
      verdict: verdict('NO SOURCE SUPPLIED', 'skipped', 'pass --source to measure matched chains'),
      items: [],
    });
  }

  // 2. invisible unicode -----------------------------------------------------
  const invisible = findInvisible(doc.text);
  report.sections.push({
    title: '2. Invisible / tracking Unicode',
    verdict: verdict(
      invisible.length ? 'FOUND' : 'CLEAN',
      invisible.length ? 'bad' : 'ok',
      invisible.length
        ? invisible.map((i) => i.code + ' ' + i.name + ' x' + i.count).join(', ')
        : 'no zero-width, directional or format characters found'
    ),
    items: invisible.map((i) => ({ code: i.code, name: i.name, count: i.count })),
  });

  // 3. burstiness ------------------------------------------------------------
  const b = burstiness(doc.text);
  let burstLevel = 'ok';
  let burstDetail = 'sentence lengths vary naturally';
  if (b.count >= 5 && b.cv < 0.30) {
    burstLevel = 'bad';
    burstDetail = 'very uniform sentence rhythm (CV ' + b.cv.toFixed(2) + '), a strong machine tell';
  } else if (b.count >= 5 && b.cv < 0.40) {
    burstLevel = 'warn';
    burstDetail = 'fairly uniform sentence rhythm (CV ' + b.cv.toFixed(2) + ')';
  }
  report.sections.push({
    title: '3. Sentence-length variation',
    verdict: verdict(burstLevel === 'ok' ? 'VARIED' : burstLevel === 'warn' ? 'FLAT' : 'UNIFORM', burstLevel, burstDetail),
    stats: {
      sentences: b.count,
      meanWords: Math.round(b.mean * 10) / 10,
      sdWords: Math.round(b.sd * 10) / 10,
      coefficientOfVariation: Math.round(b.cv * 100) / 100,
    },
    items: [],
  });

  // 4. lexical diversity -----------------------------------------------------
  const diversityTtr = ttr(tokenList);
  const diversityMattr = mattr(tokenList, 100);
  let divLevel = 'ok';
  let divDetail = 'vocabulary range looks normal';
  if (diversityMattr < 0.38) {
    divLevel = 'warn';
    divDetail = 'low lexical diversity (MATTR-100 ' + diversityMattr.toFixed(2) + ')';
  }
  report.sections.push({
    title: '4. Lexical diversity',
    verdict: verdict(divLevel === 'ok' ? 'NORMAL' : 'NARROW', divLevel, divDetail),
    stats: {
      typeTokenRatio: Math.round(diversityTtr * 1000) / 1000,
      mattr100: Math.round(diversityMattr * 1000) / 1000,
    },
    items: [],
  });

  // 5. discourse marker repetition -------------------------------------------
  const markers = countPhrases(doc.text, DISCOURSE_MARKERS);
  const repeated = markers.filter((m) => m.count > 2);
  report.sections.push({
    title: '5. Discourse-marker repetition',
    verdict: verdict(
      repeated.length ? 'REPETITIVE' : 'VARIED',
      repeated.length ? 'warn' : 'ok',
      repeated.length
        ? repeated.map((m) => '"' + m.phrase + '" x' + m.count).join(', ')
        : 'no marker used more than twice'
    ),
    items: markers.slice(0, 15),
  });

  // 6. trigger phrases --------------------------------------------------------
  const triggers = countPhrases(doc.text, TRIGGER_PHRASES);
  report.sections.push({
    title: '6. High-frequency machine phrase hits',
    verdict: verdict(
      triggers.length ? 'REVIEW' : 'CLEAN',
      triggers.length ? 'warn' : 'ok',
      triggers.length ? triggers.length + ' distinct phrase(s) found' : 'none found'
    ),
    items: triggers,
  });

  // 7. compression entropy ---------------------------------------------------
  const comp = compressionEntropy(doc.text);
  let compLevel = 'ok';
  let compDetail = 'character distribution looks naturally varied';
  if (comp.entropyBitsPerChar > 0 && comp.entropyBitsPerChar < 3.6) {
    compLevel = 'warn';
    compDetail =
      'character distribution is unusually predictable (' +
      comp.entropyBitsPerChar.toFixed(2) +
      ' bits per character)';
  }
  report.sections.push({
    title: '7. Compression entropy',
    verdict: verdict(compLevel === 'ok' ? 'VARIED' : 'PREDICTABLE', compLevel, compDetail),
    stats: {
      entropyBitsPerChar: comp.entropyBitsPerChar,
      compressedRatio: comp.compressedRatio,
      rawBytes: comp.rawBytes,
      compressedBytes: comp.compressedBytes,
    },
    items: [],
  });

  // 8. paragraph alignment ----------------------------------------------------
  const align = docxAlignment(targetPath, doc.format);
  if (!align) {
    report.sections.push({
      title: '8. Paragraph alignment',
      verdict: verdict('NOT A WORD DOCUMENT', 'skipped', 'alignment is only measured for .docx files'),
      items: [],
    });
  } else if (align.paragraphs === 0) {
    report.sections.push({
      title: '8. Paragraph alignment',
      verdict: verdict('NO BODY PARAGRAPHS', 'skipped', 'the document has no body paragraphs to align'),
      items: [],
    });
  } else {
    const justified = align.counts.both || 0;
    const other = align.paragraphs - justified;
    const others = Object.keys(align.counts).filter((k) => k !== 'both');
    let alignLevel = 'ok';
    let alignDetail = 'every body paragraph is justified';
    if (other > 0) {
      alignLevel = 'warn';
      alignDetail =
        other +
        ' body paragraph(s) are not justified (' +
        others.map((k) => k + '=' + align.counts[k]).join(', ') +
        ')';
    }
    report.sections.push({
      title: '8. Paragraph alignment',
      verdict: verdict(other === 0 ? 'JUSTIFIED' : 'MIXED', alignLevel, alignDetail),
      stats: {
        bodyParagraphs: align.paragraphs,
        justified,
        notJustified: other,
      },
      items: others.map((k) => ({ phrase: k + '=' + align.counts[k], count: align.counts[k] })),
    });
  }

  report.summary = {
    words: report.words,
    worstLevel: report.sections.some((s) => s.verdict.level === 'bad')
      ? 'bad'
      : report.sections.some((s) => s.verdict.level === 'warn')
        ? 'warn'
        : 'ok',
  };

  return report;
}

function printText(report) {
  const L = [];
  const pad = (s, n) => String(s).padEnd(n);
  L.push('=== Plagiarism Minimiser Audit ===');
  L.push('File   : ' + displayPath(report.file) + '  (' + report.format + ')');
  L.push('Words  : ' + report.words);
  if (report.source) L.push('Source : ' + displayPath(report.source));
  L.push('');

  for (const s of report.sections) {
    L.push('[' + s.title + ']');
    L.push('  ' + s.verdict.label + ' - ' + s.verdict.detail);
    if (s.stats) {
      for (const [key, value] of Object.entries(s.stats)) {
        L.push('    ' + pad(key, 26) + value);
      }
    }
    for (const item of s.items.slice(0, 12)) {
      if (item.text !== undefined) {
        L.push('    [' + item.words + 'w] "' + item.text + '"');
      } else if (item.code !== undefined) {
        L.push('    ' + item.code + ' ' + item.name + ' x' + item.count);
      } else if (item.phrase !== undefined) {
        L.push('    "' + item.phrase + '" x' + item.count);
      }
    }
    if (s.items.length > 12) L.push('    ... and ' + (s.items.length - 12) + ' more');
    L.push('');
  }

  L.push('Summary: ' + report.summary.worstLevel.toUpperCase());
  L.push('Note   : no similarity or detection score can be guaranteed. These are measured signals.');
  return L.join('\n');
}

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  console.error('Usage: node scripts/audit.mjs <file> [--source <file>] [--k 5] [--json]');
  process.exit(2);
}

try {
  const report = audit(args.file, args.source, args.k);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(printText(report));
  }
} catch (err) {
  console.error('audit failed: ' + err.message);
  process.exit(1);
}
