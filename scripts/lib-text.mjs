// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
//
// Part of the plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
// lib-text.mjs — text extraction and measurement for the plagiarism-minimiser-KDBN skill.
// Node built-ins only. Shared by audit.js and purge.js.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { readZip } from './lib-zip.mjs';

// ---------------------------------------------------------------------------
// Invisible / tracking Unicode
// ---------------------------------------------------------------------------

// Keys are written as escape sequences on purpose. Literal invisible characters
// can be silently lost when a file is written or copied, which would leave the
// map holding an empty key and the detector blind to that code point.
// Keys are written as escape sequences on purpose. Literal invisible characters
// can be silently lost when a file is written or copied, which would leave the
// map holding an empty key and the detector blind to that code point.
export const INVISIBLE_CHARS = new Map([
  ['\u200B', 'ZERO WIDTH SPACE'],
  ['\u200C', 'ZERO WIDTH NON-JOINER'],
  ['\u200D', 'ZERO WIDTH JOINER'],
  ['\u2060', 'WORD JOINER'],
  ['\uFEFF', 'ZERO WIDTH NO-BREAK SPACE / BOM'],
  ['\u00AD', 'SOFT HYPHEN'],
  ['\u180E', 'MONGOLIAN VOWEL SEPARATOR'],
  ['\u200E', 'LEFT-TO-RIGHT MARK'],
  ['\u200F', 'RIGHT-TO-LEFT MARK'],
  ['\u061C', 'ARABIC LETTER MARK'],
  ['\u202A', 'LEFT-TO-RIGHT EMBEDDING'],
  ['\u202B', 'RIGHT-TO-LEFT EMBEDDING'],
  ['\u202C', 'POP DIRECTIONAL FORMATTING'],
  ['\u202D', 'LEFT-TO-RIGHT OVERRIDE'],
  ['\u202E', 'RIGHT-TO-LEFT OVERRIDE'],
  ['\u2061', 'FUNCTION APPLICATION'],
  ['\u2062', 'INVISIBLE TIMES'],
  ['\u2063', 'INVISIBLE SEPARATOR'],
  ['\u2064', 'INVISIBLE PLUS'],
  ['\u2066', 'LEFT-TO-RIGHT ISOLATE'],
  ['\u2067', 'RIGHT-TO-LEFT ISOLATE'],
  ['\u2068', 'FIRST STRONG ISOLATE'],
  ['\u2069', 'POP DIRECTIONAL ISOLATE'],
  ['\u3164', 'HANGUL FILLER'],
  ['\u3165', 'HANGUL CHOSEONG FILLER'],
  ['\uFFA0', 'HALFWIDTH HANGUL FILLER'],
]);

export const INVISIBLE_PATTERN = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD\u180E\u200E\u200F\u061C\u202A\u202B\u202C\u202D\u202E\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u3164\u3165\uFFA0]/g;

export function findInvisible(text) {
  const hits = new Map();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (INVISIBLE_CHARS.has(ch)) {
      const code = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      const key = `${code} ${INVISIBLE_CHARS.get(ch)}`;
      if (!hits.has(key)) hits.set(key, { code, name: INVISIBLE_CHARS.get(ch), count: 0, first: i });
      hits.get(key).count++;
    }
  }
  return [...hits.values()].sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlToText(xml) {
  let s = xml;
  s = s.replace(/<w:p\b[^>]*>/g, '\n');
  s = s.replace(/<w:tr\b[^>]*>/g, '\n');
  s = s.replace(/<w:tc\b[^>]*>/g, '\t');
  s = s.replace(/<w:br\b[^>]*\/?>/g, '\n');
  s = s.replace(/<w:cr\b[^>]*\/?>/g, '\n');
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  s = s.replace(/<[^>]+>/g, '');
  return decodeEntities(s);
}

function docxToText(buf) {
  const entries = readZip(buf);
  const wanted = [];
  for (const e of entries) {
    const n = e.name.replace(/\\/g, '/');
    if (
      n === 'word/document.xml' ||
      /^word\/(header|footer)\d*\.xml$/.test(n) ||
      n === 'word/footnotes.xml' ||
      n === 'word/endnotes.xml' ||
      n === 'word/comments.xml'
    ) {
      wanted.push({ name: n, data: e.data.toString('utf8') });
    }
  }
  if (!wanted.length) throw new Error('no WordprocessingML body found in package');
  return wanted.map((w) => `\n\n[${w.name}]\n` + xmlToText(w.data)).join('\n');
}

function texToText(tex) {
  let s = tex;
  s = s.replace(/(^|[^\\])%.*$/gm, '$1');
  s = s.replace(/\\documentclass[\s\S]*?\\begin\{document\}/, '');
  s = s.replace(/\\end\{document\}[\s\S]*$/, '');
  s = s.replace(
    /\\(?:cite|citep|citet|ref|label|footnote|footnotemark|includegraphics|usepackage|documentclass|begin|end|bibliography|bibliographystyle|input|include|url|href)\s*(\{[^{}]*\}|\[[^\]]*\])*/g,
    ' '
  );
  s = s.replace(/\\[a-zA-Z@]+\s*(\{[^{}]*\})*/g, ' ');
  s = s.replace(/[{}]/g, ' ');
  return s;
}

/** Extract plain text from .docx, .tex, .md, .txt or any text-like file. */
export function extractText(filePath) {
  const ext = extname(filePath).toLowerCase();
  const buf = readFileSync(filePath);
  if (ext === '.docx') return { text: docxToText(buf), format: 'docx' };
  if (ext === '.tex') return { text: texToText(buf.toString('utf8')), format: 'tex' };
  return { text: buf.toString('utf8'), format: ext.replace('.', '') || 'txt' };
}

// ---------------------------------------------------------------------------
// Tokenisation
// ---------------------------------------------------------------------------

/**
 * Word tokens with their offsets in the source string.
 * Mirrors how a similarity engine normalises: lowercase, punctuation dropped.
 */
export function tokenize(text) {
  const out = [];
  const re = /[A-Za-z0-9]+(?:['\u2019][A-Za-z]+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ token: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function tokenStrings(text) {
  return tokenize(text).map((t) => t.token);
}

// ---------------------------------------------------------------------------
// Shared-chain detection (the similarity risk)
// ---------------------------------------------------------------------------

/**
 * Find maximal runs of identical tokens shared by two texts.
 * Returns runs of length >= k, merged so nested matches collapse into one.
 */
export function sharedChains(aTokens, bTokens, k = 5) {
  const index = new Map();
  for (let i = 0; i + k <= bTokens.length; i++) {
    const key = bTokens.slice(i, i + k).join(' ');
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(i);
  }

  const raw = [];
  const seen = new Set();
  for (let i = 0; i + k <= aTokens.length; i++) {
    const key = aTokens.slice(i, i + k).join(' ');
    const positions = index.get(key);
    if (!positions) continue;

    for (const p of positions) {
      let back = 0;
      while (
        i - back - 1 >= 0 &&
        p - back - 1 >= 0 &&
        aTokens[i - back - 1] === bTokens[p - back - 1]
      ) {
        back++;
      }
      let fwd = k;
      while (
        i + fwd < aTokens.length &&
        p + fwd < bTokens.length &&
        aTokens[i + fwd] === bTokens[p + fwd]
      ) {
        fwd++;
      }
      const startA = i - back;
      const len = back + fwd;
      const id = `${startA}:${len}`;
      if (seen.has(id)) continue;
      seen.add(id);
      raw.push({ startA, startB: p - back, len });
    }
  }

  raw.sort((x, y) => x.startA - y.startA);
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.startA < last.startA + last.len) {
      if (r.startA + r.len > last.startA + last.len) {
        last.len = r.startA + r.len - last.startA;
      }
      continue;
    }
    merged.push(r);
  }

  return merged
    .filter((r) => r.len >= k)
    .map((r) => ({ ...r, text: aTokens.slice(r.startA, r.startA + r.len).join(' ') }));
}

// ---------------------------------------------------------------------------
// Style signals
// ---------------------------------------------------------------------------

export function splitSentences(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+(?=["'(A-Z])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Sentence-length variation. Uniform rhythm is one of the clearest machine tells. */
export function burstiness(text) {
  const sentences = splitSentences(text);
  const lengths = sentences.map((s) => (s.match(/[A-Za-z0-9]+/g) || []).length);
  if (lengths.length < 2) return { count: lengths.length, mean: 0, sd: 0, cv: 0, lengths: [] };
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / (lengths.length - 1);
  const sd = Math.sqrt(variance);
  return { count: lengths.length, mean, sd, cv: mean ? sd / mean : 0, lengths };
}

/** Type-token ratio over the whole text. Falls with length, so read it with MATTR. */
export function ttr(tokens) {
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

/** Moving-average type-token ratio. Length-normalised, so comparable across drafts. */
export function mattr(tokens, window = 100) {
  if (tokens.length < window) return ttr(tokens);
  let sum = 0;
  let count = 0;
  for (let i = 0; i + window <= tokens.length; i++) {
    sum += new Set(tokens.slice(i, i + window)).size / window;
    count++;
  }
  return count ? sum / count : 0;
}

// ---------------------------------------------------------------------------
// Phrase inventories
// ---------------------------------------------------------------------------

export const TRIGGER_PHRASES = [
  'delve into', 'delves into', 'delving into', 'by delving',
  'plays a crucial role', 'pivotal role', 'key role', 'significant role',
  'it is important to note', 'it is worth noting', 'it should be noted',
  'it is essential to', 'it is crucial to', 'needless to say',
  'in today\'s', 'in the modern era', 'in the realm of', 'in the landscape of',
  'a testament to', 'serves as a', 'stands as a', 'is a testament',
  'comprehensive overview', 'comprehensive analysis', 'comprehensive examination',
  'navigating the complexities', 'navigate the complexities', 'navigating the landscape',
  'underscores the importance', 'underscore the importance', 'highlighting the importance',
  'when it comes to', 'at the end of the day', 'the world of',
  'not only', 'but also', 'seamless', 'seamlessly', 'robust',
  'leverage', 'leveraging', 'leverages', 'harnessing', 'harness the power',
  'tapestry', 'testament to', 'realm of', 'cutting-edge', 'state-of-the-art',
  'game-changing', 'paradigm shift', 'paradigm-shifting',
  'fostering', 'foster a', 'embark on', 'embarked on', 'unlock the potential',
  'elevate', 'elevating', 'intricacies', 'intricate', 'boasts', 'showcasing',
  'furthermore', 'moreover', 'in conclusion', 'to sum up', 'in summary',
  'this article explores', 'this paper explores', 'this study explores',
  'provide a', 'offer a', 'delve', 'pivotal', 'tapestries', 'evolving landscape',
  'shed light on', 'sheds light on', 'pave the way', 'paves the way',
];

export const DISCOURSE_MARKERS = [
  'however', 'therefore', 'moreover', 'furthermore', 'thus', 'hence', 'consequently',
  'accordingly', 'nevertheless', 'nonetheless', 'additionally', 'similarly',
  'specifically', 'notably', 'meanwhile', 'conversely', 'ultimately', 'evidently',
  'essentially', 'typically', 'indeed', 'in addition', 'in contrast',
  'on the other hand', 'as a result', 'for example', 'for instance',
  'first', 'second', 'third', 'finally', 'in particular', 'more importantly',
  'by contrast', 'that said', 'in fact', 'on the contrary',
];

/**
 * Count how often each phrase appears in the text.
 *
 * The match is a whole-word one: "in conclusion" must not be found inside
 * "main conclusions", and "provide a" must not be found inside "provided a".
 * The rewriting engine is stricter still, because it refuses any swap that
 * would create a phrase even inside a longer word, so a document that passes
 * the engine can never fail the audit on this ground.
 */
export function countPhrases(text, phrases) {
  const lower = text.toLowerCase();
  const found = [];
  for (const phrase of phrases) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'g');
    const hits = lower.match(re);
    const count = hits ? hits.length : 0;
    if (count > 0) found.push({ phrase, count });
  }
  return found.sort((a, b) => b.count - a.count);
}

export function displayPath(p) {
  return basename(p) || p;
}
