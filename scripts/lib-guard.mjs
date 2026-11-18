// lib-guard.mjs — content-based paragraph guards.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// A Word document does not have to use heading styles. A manuscript written in
// Word with every paragraph left on "Normal" still has headings, captions,
// code listings and a reference list, and an engine that recognises them only
// by style name will treat all of them as ordinary prose.
//
// This module recognises those parts from the text itself, so the rewriting
// engine and the justification helper both leave them alone, whether or not
// the document uses Word styles.
//
// The kinds returned are:
//   prose      ordinary body text, the only kind that may be rewritten
//   title      the document title
//   heading    a numbered section heading
//   label      a figure or table label, for example "Figure 1"
//   caption    a figure or table caption, and a table note
//   code       a source-code listing
//   reference  an entry in the reference list
//   blank      an empty paragraph

export const CODE_STYLE = /^(SourceCode|Code|HTMLPreformatted|MacroText|Preformatted)/i;
export const HEADING_STYLE = /^(Heading\s?[1-6]|Title|Subtitle|Caption|TOC\s?\d)/i;

// "1. Introduction", "1.1 Background", "2.1.1 Mechanisms", "A.1 Complete Script".
// The word after the number must start with a capital letter, so that a
// sentence such as "2050 is the target year" is not read as a heading. The
// letter form needs at least one number after it, so that an ordinary
// sentence opening with a capital letter is not read as an appendix heading.
const HEADING_RE = /^(?:\d+(?:\.\d+)*\.?|[A-Z](?:\.\d+)+)\s+[A-Z]/;

// "Figure 1", "Table 2", "Fig. 3". The label must be the whole paragraph, so
// that a sentence such as "Table 1 gives the comparison" stays prose.
const LABEL_RE = /^(?:Figure|Table|Fig\.?)\s*\d+\s*[.:]?$/;

// "Note. IAE = integral of absolute error over 15 s."
const NOTE_RE = /^Note[.:]\s/;

// A quoted file name such as 'Main_Script_All_Figures.m'. The extension is
// required, so an apostrophe inside an ordinary word cannot match.
const FILENAME_RE = /'[^'<>|\n]{1,120}\.[A-Za-z0-9]{1,8}'/;

// A comment line, a section marker or a shebang.
const CODE_COMMENT_RE = /^\s*(?:%%|%|\/\/|#!|#)/;

// An assignment at the start of a line: "K_nominal = 1.0;". A tuple
// assignment counts too, because "K0, ZETA0, WN0 = 1.0, 0.1, 1.0" is just as
// much code as a single assignment.
const CODE_ASSIGN_RE = /^\s*[\w.$\[\]'"]+(?:\s*,\s*[\w.$\[\]'"]+)*\s*=(?!=)/;

// A docstring: """...""" or '''...'''.
const CODE_DOCSTRING_RE = /^\s*(?:"""|''')/;

// A block keyword at the start of a line: "for i = 1:n7", "end".
// The match is case sensitive on purpose, because "For", "If", "End" and
// "Case" all open ordinary English sentences. The names that are also
// ordinary words in prose, such as "figure" and "print", are only counted
// when they are followed by an opening bracket.
const CODE_KEYWORD_RE =
  /^\s*(?:for|while|if|elseif|else|end|function|try|catch|return|break|continue|def|import)\b(?=[\s(]|$)/;
const CODE_CALL_RE =
  /^\s*(?:print|plot|figure|subplot|fprintf|disp|error|assert|input|title|legend|grid|hold)\s*\(/;

// An expression statement: a call that is the whole line and ends the line
// with a closing bracket. The closed list of function names above cannot
// catch every call, so a line such as
//   scenario("Iced (Adapted)", 0.2, KP * K0 / plant(0.2)[0])
// has to be recognised as code as well.
const CODE_EXPRESSION_RE = /^\s*[A-Za-z_]\w*\s*\(.*[,=].*\)\s*\]?\s*$/;

// Ordinary English function words. A line that holds one of them is prose
// that happens to be wrapped in brackets, not a call.
const PROSE_WORD_RE =
  /\b(?:the|and|of|to|in|is|are|was|were|that|this|these|those|for|with|by|from|as|it|its|their|his|her|our|which|who|not|but|so|if|then|than|we|our|they|be|been|has|have|had|can|could|may|might|must|will|would|should)\b/i;

/**
 * True when the paragraph is a source-code listing rather than prose.
 */
export function looksLikeCode(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (CODE_COMMENT_RE.test(t)) return true;
  if (CODE_ASSIGN_RE.test(t)) return true;
  if (CODE_DOCSTRING_RE.test(t)) return true;
  if (CODE_KEYWORD_RE.test(t)) return true;
  if (CODE_CALL_RE.test(t)) return true;
  // A statement that ends in a semicolon and carries a call or an assignment.
  // The semicolon has to be at the end, because a semicolon inside a list of
  // citations is ordinary academic punctuation.
  if (/;\s*$/.test(t) && (/[=(]/.test(t) || (t.match(/;/g) || []).length >= 2)) return true;
  // An expression statement. It must not finish with a full stop, because
  // prose does, and it must not hold an ordinary English word.
  if (!/[.!?]$/.test(t) && CODE_EXPRESSION_RE.test(t) && !PROSE_WORD_RE.test(t)) return true;
  return false;
}

/** True when the paragraph is a numbered section heading. */
export function looksLikeHeading(text) {
  const t = (text || '').trim();
  if (!t || t.length > 140) return false;
  if (!HEADING_RE.test(t)) return false;
  // A heading does not finish with a full stop.
  if (/[.!?]$/.test(t)) return false;
  return true;
}

/** True when the paragraph is a figure or table label. */
export function looksLikeLabel(text) {
  return LABEL_RE.test((text || '').trim());
}

/** True when the paragraph is a table or figure note. */
export function looksLikeNote(text) {
  return NOTE_RE.test((text || '').trim());
}

/** True when the paragraph names a file that the reader has to be given exactly. */
export function looksLikeFilename(text) {
  return FILENAME_RE.test(text || '');
}

/**
 * True when the paragraph reads like a document title.
 *
 * A title is long, does not finish with a full stop and is not a sentence.
 */
export function looksLikeTitle(text) {
  const t = (text || '').trim();
  if (t.length < 40 || t.length > 400) return false;
  if (/[.?!]$/.test(t)) return false;
  const words = t.split(/\s+/).length;
  return words >= 5 && words <= 30;
}

/**
 * Classify a sequence of paragraphs.
 *
 * Each record is { text, style, italicAll }. The sequence matters, because a
 * caption is recognised by the label above it and a reference entry by the
 * "References" heading above it.
 *
 * Returns an array of kinds, one per record.
 */
export function classifySequence(records) {
  const kinds = new Array(records.length).fill('prose');
  let firstTextSeen = false;
  let inReferences = false;

  // A run of consecutive code paragraphs is a listing, and a line inside it
  // that the content checks did not recognise is still a line of code. The
  // run is found afterwards, because the check for one line cannot know what
  // surrounds it.
  const codeCandidates = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i] || {};
    const text = (rec.text || '').trim();
    const style = rec.style || '';

    if (!text) {
      kinds[i] = 'blank';
      continue;
    }

    // A cell of a table is reported as such, because a cell has its own
    // width and its own alignment rules.
    if (rec.inTable === true) {
      kinds[i] = 'table';
      continue;
    }

    // A style that names a heading, a caption or a title settles it.
    if (CODE_STYLE.test(style)) {
      kinds[i] = 'code';
      inReferences = false;
      continue;
    }
    if (HEADING_STYLE.test(style)) {
      kinds[i] = /^Title$/i.test(style) ? 'title' : 'heading';
      inReferences = false;
      continue;
    }

    // The content checks come before anything that depends on position, so a
    // first paragraph that is really code stays code.
    if (looksLikeCode(text)) {
      kinds[i] = 'code';
      firstTextSeen = true;
      continue;
    }
    if (looksLikeHeading(text)) {
      kinds[i] = 'heading';
      // A heading ends a reference list, so "Appendix A" starts the appendices.
      inReferences = false;
      firstTextSeen = true;
      continue;
    }
    if (looksLikeLabel(text)) {
      kinds[i] = 'label';
      firstTextSeen = true;
      continue;
    }
    if (looksLikeNote(text)) {
      kinds[i] = 'caption';
      firstTextSeen = true;
      continue;
    }

    // "References" opens the reference list.
    if (/^references\s*$/i.test(text)) {
      kinds[i] = 'heading';
      inReferences = true;
      firstTextSeen = true;
      continue;
    }

    // A short centred paragraph is a display element: a paper title, an
    // author block, an abstract heading or an appendix title. It is neither
    // body prose to rewrite nor body prose to justify.
    if (rec.align === 'center' && text.length <= 90 && !/[.!?]$/.test(text)) {
      kinds[i] = 'heading';
      firstTextSeen = true;
      continue;
    }

    if (!firstTextSeen) {
      firstTextSeen = true;
      if (looksLikeTitle(text)) {
        kinds[i] = 'title';
        continue;
      }
    }

    if (inReferences) {
      kinds[i] = 'reference';
      continue;
    }

    // A caption sits directly under its label, and is normally italic.
    if (i > 0 && kinds[i - 1] === 'label') {
      kinds[i] = 'caption';
      continue;
    }
    if (rec.italicAll === true) {
      kinds[i] = 'caption';
      continue;
    }

    kinds[i] = 'prose';
  }

  // A run of three or more consecutive code paragraphs is a listing. Any
  // paragraph inside that run that the content checks did not recognise is
  // still a line of code, and the engine must leave it alone.
  let runStart = -1;
  for (let i = 0; i <= kinds.length; i++) {
    const isCode = i < kinds.length && kinds[i] === 'code';
    if (isCode && runStart === -1) runStart = i;
    if (!isCode && runStart !== -1) {
      if (i - runStart >= 3) {
        for (let k = runStart; k < i; k++) {
          if (kinds[k] === 'prose') kinds[k] = 'code';
        }
      }
      runStart = -1;
    }
  }

  return kinds;
}

/**
 * Read the paragraphs of a WordprocessingML document for the guard.
 *
 * Each record carries the plain text, the paragraph style name and whether
 * every run in the paragraph is italic.
 */
export function extractGuardRecords(xml) {
  const tableRanges = [];
  const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let t;
  while ((t = tblRe.exec(xml)) !== null) {
    tableRanges.push([t.index, t.index + t[0].length]);
  }

  const records = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const inner = m[1];
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let tt;
    while ((tt = tRe.exec(inner)) !== null) texts.push(decodeEntities(tt[1]));
    const style = (inner.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';

    const rPrs = [];
    const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    let r;
    while ((r = runRe.exec(inner)) !== null) {
      const rPr = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/);
      rPrs.push(rPr ? rPr[0] : '');
    }
    const withText = rPrs.length;
    const italicAll =
      withText > 0 && rPrs.every((p) => /<w:i\s*\/>/.test(p));

    const jc = (inner.match(/<w:jc\b[^>]*w:val="([^"]+)"[^>]*\/>/) || [])[1] || '';

    records.push({
      text: texts.join(''),
      style,
      italicAll,
      align: jc,
      inTable: tableRanges.some(([a, b]) => m.index >= a && m.index < b),
    });
  }

  return records;
}

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
