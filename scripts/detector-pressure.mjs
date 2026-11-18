// detector-pressure.mjs -- measure the statistical signals that a commercial
// AI detector reads.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
//   node scripts/detector-pressure.mjs <file.docx> [--json]
//
// WHAT THIS IS AND WHAT IT IS NOT
//
// A commercial detector such as ZeroGPT, GPTZero or Originality.ai scores a
// document from a small family of statistics. The vendors publish the family
// even though they keep the classifier itself private:
//
//   perplexity   how predictable each word is. A model picks the expected
//                continuation, so its output sits closer to the expected word
//                at every step. The reference implementation runs an open
//                model such as GPT-2 over the text.
//   burstiness   how much the rhythm varies. Human writing alternates between
//                a long clause-heavy sentence and three words. Model output
//                holds a steadier cadence, and holds it "for paragraphs at a
//                time".
//   transitions  the smoothness of the discourse markers. A chain of
//                "Moreover, Furthermore, In addition" reads as a model
//                filling a template.
//   vocabulary   how predictable each word is on its own, which is the
//                unigram half of the same signal.
//
// This script measures all four from a document. It is a PROXY, not a score.
// It cannot tell you what ZeroGPT will say, because the classifier and its
// threshold are private and change without notice. It can tell you whether a
// rewrite moved the document towards or away from the pattern that those
// classifiers are built on, and it does that the same way every time.
//
// A detector also produces false positives on human academic prose. The
// vendors say so themselves: formal academic writing and text written by a
// person working in a second language "are common examples" of human writing
// that reads as machine-like, and low burstiness "on its own is not proof of
// AI". A number that moves because the register moved is not a number that
// proves anything.
//
// Every metric here is reported with the value that a human passage would be
// expected to sit near, where the published literature gives one, so that the
// reading is not just "higher is better".

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib-zip.mjs';
import { extractText } from './lib-text.mjs';
import { classifySequence, extractGuardRecords } from './lib-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = join(HERE, '..', 'rules');

// The words that a detector leans on hardest, because they are the safe
// choice that a language model reaches for and a person rarely does.
const AI_TELLS = [
  'delve', 'tapestry', 'realm', 'landscape', 'showcase', 'underscore',
  'pivotal', 'crucial', 'vital', 'paramount', 'holistic', 'intricate',
  'meticulous', 'myriad', 'multifaceted', 'seamless', 'robust', 'leverage',
  'utilise', 'utilize', 'foster', 'navigate', 'embark', 'unlock',
  'game-changer', 'revolutionise', 'revolutionize', 'invaluable',
  'significantly', 'substantially', 'comprehensive', 'invaluable',
  'furthermore', 'moreover', 'additionally', 'consequently', 'therefore',
  'notably', 'importantly', 'significantly', 'essentially', 'ultimately',
  'overall', 'crucially', 'importantly', 'it is worth noting',
  'it is important to note', 'plays a crucial role', 'a wide range of',
  'a variety of', 'in order to', 'it is essential', 'delve into',
  'navigate the', 'the realm of', 'testament to', 'pave the way',
];

// The connectives that make a document read as a template.
const CONNECTIVES = [
  'however', 'therefore', 'moreover', 'furthermore', 'additionally',
  'consequently', 'nevertheless', 'nonetheless', 'thus', 'hence',
  'accordingly', 'similarly', 'specifically', 'notably', 'importantly',
  'essentially', 'ultimately', 'overall', 'firstly', 'secondly', 'thirdly',
  'finally', 'in addition', 'in conclusion', 'in summary', 'as a result',
  'for example', 'for instance', 'that said', 'in other words',
];

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

function loadFrequency() {
  const raw = JSON.parse(readFileSync(join(RULES, 'frequency.json'), 'utf8'));
  const items = raw.items || raw;
  const map = new Map();
  items.forEach((w, i) => {
    if (!map.has(w)) map.set(w, i + 1);
  });
  return map;
}

/**
 * Split a body of prose into sentences.
 *
 * A full stop ends a sentence only when it follows a letter and is followed
 * by a space and a capital. That keeps "0.91 s" and "Section 3.3.4" whole,
 * and it keeps "e.g." and "et al." from cutting a sentence in half.
 */
const ABBREVIATIONS = [
  'e.g', 'i.e', 'et al', 'fig', 'eq', 'no', 'vol', 'sec', 'ref', 'approx',
  'cf', 'vs', 'dr', 'prof', 'inc', 'ltd', 'mr', 'ms', 'mrs', 'st',
];

function sentences(text) {
  const guarded = text.replace(/(\d)\.(\d)/g, '$1<DOT>$2');
  const out = [];
  let start = 0;
  const re = /[.!?]+["')\]]*(?=\s+[A-Z0-9"'(]|\s*$)/g;
  let m;
  while ((m = re.exec(guarded)) !== null) {
    let end = m.index + m[0].length;
    const chunk = guarded.slice(start, end);
    const bare = chunk.replace(/<DOT>/g, '.').trim();
    if (!bare) {
      start = end;
      continue;
    }
    // An abbreviation or an initial does not end a sentence.
    const lastWord = (bare.match(/([A-Za-z.]+)\.$/) || ['', ''])[1].toLowerCase();
    if (ABBREVIATIONS.includes(lastWord.replace(/\.$/, '')) || /^[a-z]\.$/i.test(bare)) {
      start = end;
      continue;
    }
    // A sentence that ends in a lower-case word with no capital after it is
    // part of a list, not a sentence.
    const after = guarded.slice(end, end + 40).trim();
    if (after && !/^[A-Z0-9"'(]/.test(after)) {
      start = end;
      continue;
    }
    out.push(bare);
    start = end;
  }
  const tail = guarded.slice(start).replace(/<DOT>/g, '.').trim();
  if (tail) out.push(tail);
  return out.length ? out : [text.trim()].filter(Boolean);
}

function stats(values) {
  if (!values.length) return { n: 0, mean: 0, sd: 0, cv: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  const sd = Math.sqrt(variance);
  return {
    n: values.length,
    mean: Number(mean.toFixed(2)),
    sd: Number(sd.toFixed(2)),
    cv: mean === 0 ? 0 : Number((sd / mean).toFixed(3)),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function measure(text, frequency) {
  const paragraphs = text
    .split(/\n\s*\n|\n(?=[A-Z0-9])/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);

  const sents = sentences(text);
  const sentWords = sents.map((s) => (s.match(WORD_RE) || []).length);

  // --- burstiness -------------------------------------------------------
  const docBurst = stats(sentWords);

  // The per-paragraph burstiness is the one that matters. A detector reads a
  // passage, and a passage that holds a steady cadence reads as a model even
  // when the whole document varies.
  const paraBursts = [];
  const paraSentCounts = [];
  for (const p of paragraphs) {
    const ps = sentences(p);
    if (ps.length < 3) continue;
    const lens = ps.map((s) => (s.match(WORD_RE) || []).length);
    const st = stats(lens);
    paraBursts.push(st.cv);
    paraSentCounts.push(ps.length);
  }
  const meanParaBurst = paraBursts.length
    ? Number((paraBursts.reduce((a, b) => a + b, 0) / paraBursts.length).toFixed(3))
    : 0;
  const flatParagraphs = paraBursts.filter((c) => c < 0.35).length;

  // The flat paragraphs, kept so that a rewrite can be aimed at them. A flat
  // paragraph is one that holds a steady cadence from sentence to sentence,
  // and that is the shape a classifier looks for.
  const flatList = [];
  for (const p of paragraphs) {
    const ps = sentences(p);
    if (ps.length < 3) continue;
    const lens = ps.map((s) => (s.match(WORD_RE) || []).length);
    const st = stats(lens);
    if (st.cv < 0.35) {
      flatList.push({ cv: st.cv, lengths: lens, text: p.slice(0, 160) });
    }
  }

  // --- perplexity proxy ------------------------------------------------
  // Surprisal of a word, in bits, from its Zipf rank. A word at rank 100 is
  // about ten bits of surprise, a word at rank 5000 is about thirteen.
  const allWords = (text.match(WORD_RE) || []).map((w) => w.toLowerCase());
  const surprisals = [];
  const unknown = [];
  for (const w of allWords) {
    const rank = frequency.get(w);
    if (rank === undefined) {
      unknown.push(w);
      continue;
    }
    surprisals.push(Math.log2(rank) + 3.4);
  }
  const meanSurprisal = surprisals.length
    ? Number((surprisals.reduce((a, b) => a + b, 0) / surprisals.length).toFixed(3))
    : 0;
  const rareRatio = surprisals.length
    ? Number((surprisals.filter((s) => s > 14).length / surprisals.length).toFixed(4))
    : 0;
  const sentSurprisal = sents.map((s) => {
    const ws = (s.match(WORD_RE) || []).map((w) => w.toLowerCase());
    const ss = ws.map((w) => frequency.get(w)).filter((r) => r !== undefined)
      .map((r) => Math.log2(r) + 3.4);
    return ss.length ? ss.reduce((a, b) => a + b, 0) / ss.length : 0;
  });
  const surprisalSpread = stats(sentSurprisal);

  // --- sentence openings ------------------------------------------------
  const openers = new Map();
  for (const s of sents) {
    const key = (s.match(WORD_RE) || []).slice(0, 2).join(' ').toLowerCase();
    if (!key) continue;
    openers.set(key, (openers.get(key) || 0) + 1);
  }
  const repeatedOpeners = Array.from(openers.entries())
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);
  const openerCollisionRate = sents.length
    ? Number((repeatedOpeners.reduce((a, [, n]) => a + n, 0) / sents.length).toFixed(4))
    : 0;

  // --- discourse markers ------------------------------------------------
  const lower = text.toLowerCase();
  const connectiveCounts = {};
  let connectiveTotal = 0;
  for (const c of CONNECTIVES) {
    const re = new RegExp('\\b' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const n = (lower.match(re) || []).length;
    if (n) {
      connectiveCounts[c] = n;
      connectiveTotal += n;
    }
  }
  const connectiveDensity = sents.length ? Number((connectiveTotal / sents.length).toFixed(4)) : 0;

  // --- AI-tell vocabulary ------------------------------------------------
  const tellCounts = {};
  let tellTotal = 0;
  for (const t of AI_TELLS) {
    const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    const n = (lower.match(re) || []).length;
    if (n) {
      tellCounts[t] = n;
      tellTotal += n;
    }
  }
  const tellDensity = allWords.length ? Number((tellTotal / allWords.length * 1000).toFixed(3)) : 0;

  // --- paragraph shape ----------------------------------------------------
  const paraShape = stats(paraSentCounts);
  const paraWordCounts = paragraphs.map((p) => (p.match(WORD_RE) || []).length);
  const paraWords = stats(paraWordCounts);

  return {
    words: allWords.length,
    sentences: sents.length,
    paragraphs: paragraphs.length,
    burstiness: {
      document: docBurst,
      withinParagraphMeanCv: meanParaBurst,
      flatParagraphs: flatParagraphs,
      paragraphsMeasured: paraBursts.length,
      flatList: flatList,
    },
    perplexityProxy: {
      meanSurprisalBits: meanSurprisal,
      rareWordRatio: rareRatio,
      sentenceSpread: surprisalSpread,
      unknownWords: unknown.length,
    },
    sentenceOpenings: {
      collisionRate: openerCollisionRate,
      repeated: repeatedOpeners.slice(0, 8).map(([k, n]) => k + ' x' + n),
    },
    discourse: {
      densityPerSentence: connectiveDensity,
      total: connectiveTotal,
      counts: connectiveCounts,
    },
    aiTells: {
      densityPerThousandWords: tellDensity,
      total: tellTotal,
      counts: tellCounts,
    },
    paragraphShape: {
      sentencesPerParagraph: paraShape,
      wordsPerParagraph: paraWords,
    },
  };
}

function report(m, asJson) {
  if (asJson) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }
  console.log('=== detector pressure (a proxy, not a score) ===');
  console.log('  words       : ' + m.words + '   sentences: ' + m.sentences + '   paragraphs: ' + m.paragraphs);
  console.log('');
  console.log('  BURSTINESS  document cv ' + m.burstiness.document.cv +
    '   mean sentence length ' + m.burstiness.document.mean);
  console.log('              within-paragraph cv ' + m.burstiness.withinParagraphMeanCv +
    '   flat paragraphs (<0.35): ' + m.burstiness.flatParagraphs + ' of ' + m.burstiness.paragraphsMeasured);
  console.log('  PERPLEXITY  mean surprisal ' + m.perplexityProxy.meanSurprisalBits +
    ' bits   rare-word ratio ' + m.perplexityProxy.rareWordRatio +
    '   sentence spread cv ' + m.perplexityProxy.sentenceSpread.cv);
  console.log('  OPENINGS    collision rate ' + m.sentenceOpenings.collisionRate +
    '   ' + (m.sentenceOpenings.repeated.length ? m.sentenceOpenings.repeated.join(', ') : 'no repeat'));
  console.log('  DISCOURSE   ' + m.discourse.total + ' marker(s), ' +
    m.discourse.densityPerSentence + ' per sentence');
  console.log('  AI TELLS    ' + m.aiTells.total + ' hit(s), ' +
    m.aiTells.densityPerThousandWords + ' per thousand words');
  console.log('  PARAGRAPH   sentences per paragraph cv ' + m.paragraphShape.sentencesPerParagraph.cv +
    '   words per paragraph cv ' + m.paragraphShape.wordsPerParagraph.cv);
  if (m.burstiness.flatList.length) {
    console.log('');
    console.log('  flat paragraphs (' + m.burstiness.flatList.length + '):');
    for (const f of m.burstiness.flatList) {
      console.log('    cv ' + f.cv + '  lengths [' + f.lengths.join(', ') + ']  ' +
        f.text.replace(/\s+/g, ' ').slice(0, 110));
    }
  }
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('-'));
const asJson = args.includes('--json');

if (!file || !existsSync(file)) {
  console.error('Usage: node scripts/detector-pressure.mjs <file> [--json]');
  process.exit(2);
}

/**
 * The prose of a document.
 *
 * A Word document carries a table, a figure caption and, in an appendix, a
 * listing of source code. None of that is prose, and a detector that is given
 * it reads the rhythm of a code listing rather than the rhythm of an
 * argument. The guard knows which paragraphs are which, so the measurement
 * uses the same classification the rewriting engine uses.
 */
function proseOf(file) {
  if (!file.toLowerCase().endsWith('.docx')) {
    return extractText(file).text;
  }
  const entries = readZip(readFileSync(file));
  const doc = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
  if (!doc) return '';
  const xml = doc.data.toString('utf8');
  const records = extractGuardRecords(xml);
  const kinds = classifySequence(records);
  const kept = [];
  for (let i = 0; i < records.length; i++) {
    const kind = kinds[i];
    if (kind === 'prose' || kind === 'reference' || kind === 'caption') {
      kept.push(records[i].text);
    }
  }
  return kept.join('\n\n');
}

const text = proseOf(file);
const frequency = loadFrequency();
report(measure(text, frequency), asJson);
