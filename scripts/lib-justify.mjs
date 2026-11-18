// lib-justify.mjs — set Word paragraph alignment to justified.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// Justified text spreads the space between words so that every line but the
// last reaches both margins. Word stores this as <w:jc w:val="both"/> inside
// the paragraph properties.
//
// Three things this module deliberately does not do:
//   - it does not touch paragraphs inside a table, because a table cell has its
//     own width and justification there behaves badly
//   - it does not touch headings, titles or captions, because a centred title
//     stays centred in a paper that is otherwise justified
//   - it does not touch source-code listings, because stretched spacing ruins
//     code
//
// The reference list is justified as well. A ragged right edge down the
// reference list is the one place where a paper looks unfinished, because every
// other page of it is flush on both sides.
//
// The element is inserted in the order the WordprocessingML schema requires:
// w:jc comes after w:spacing and w:ind, and before w:rPr and w:sectPr.

import { classifySequence, extractGuardRecords } from './lib-guard.mjs';

const HEADING_STYLE = /^(Heading\s?[1-6]|Title|Subtitle|Caption|TOC\s?\d)/i;

const BEFORE_JC = [
  '<w:textDirection',
  '<w:textAlignment',
  '<w:textboxTightWrap',
  '<w:outlineLvl',
  '<w:divId',
  '<w:cnfStyle',
  '<w:rPr',
  '<w:sectPr',
  '<w:pPrChange',
];

const JUSTIFY = '<w:jc w:val="both"/>';

/** Set the alignment of one paragraph element to justified. */
export function justifyParagraph(para) {
  const pPrSelfClosing = para.match(/<w:pPr\s*\/>/);
  if (pPrSelfClosing) {
    return para.replace(pPrSelfClosing[0], '<w:pPr>' + JUSTIFY + '</w:pPr>');
  }

  const pPr = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  if (!pPr) {
    const open = para.match(/^<w:p\b[^>]*>/);
    if (!open) return para;
    const at = open[0].length;
    return para.slice(0, at) + '<w:pPr>' + JUSTIFY + '</w:pPr>' + para.slice(at);
  }

  const inner = pPr[0].replace(/^<w:pPr>/, '').replace(/<\/w:pPr>$/, '');

  // An alignment is already present, so replace its value.
  if (/<w:jc\b[^>]*\/>/.test(inner)) {
    const newInner = inner.replace(/<w:jc\b[^>]*\/>/, JUSTIFY);
    return para.replace(pPr[0], () => '<w:pPr>' + newInner + '</w:pPr>');
  }

  // Otherwise insert it in schema order.
  let at = -1;
  for (const tag of BEFORE_JC) {
    const idx = inner.indexOf(tag);
    if (idx !== -1 && (at === -1 || idx < at)) at = idx;
  }
  const newInner = at === -1 ? inner + JUSTIFY : inner.slice(0, at) + JUSTIFY + inner.slice(at);
  return para.replace(pPr[0], () => '<w:pPr>' + newInner + '</w:pPr>');
}

/**
 * Justify every body paragraph in a WordprocessingML document.
 *
 * Returns the new XML and a count of the paragraphs that were changed.
 */
export function justifyDocumentXml(xml, options = {}) {
  const includeHeadings = options.includeHeadings === true;
  const includeReferences = options.includeReferences !== false;

  // Paragraphs inside a table are found and skipped.
  const tableRanges = [];
  const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let t;
  while ((t = tblRe.exec(xml)) !== null) {
    tableRanges.push([t.index, t.index + t[0].length]);
  }

  // The paragraphs that must keep their own alignment are recognised from
  // their content, because a manuscript does not have to use Word styles.
  const records = extractGuardRecords(xml);
  const kinds = classifySequence(records);

  const edits = [];
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  let index = 0;
  while ((m = paraRe.exec(xml)) !== null) {
    const para = m[0];
    const style = (para.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';
    const inTable = tableRanges.some(([a, b]) => m.index >= a && m.index < b);
    const kind = kinds[index];
    index++;
    if (inTable) continue;
    if (!includeHeadings && HEADING_STYLE.test(style)) continue;
    if (kind !== undefined) {
      if (kind !== 'prose' && !(kind === 'reference' && includeReferences)) continue;
    }
    const updated = justifyParagraph(para);
    if (updated !== para) {
      edits.push({ start: m.index, length: para.length, text: updated });
    }
  }

  // Applied back to front, so the offsets stay valid.
  let out = xml;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.start + e.length);
  }

  return { xml: out, changed: edits.length };
}

/**
 * Count the alignment of every body paragraph in a document.
 * Used by the audit to show what the alignment actually is.
 */
export function alignmentStats(xml) {
  const tableRanges = [];
  const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let t;
  while ((t = tblRe.exec(xml)) !== null) {
    tableRanges.push([t.index, t.index + t[0].length]);
  }

  const records = extractGuardRecords(xml);
  const kinds = classifySequence(records);

  const counts = {};
  const byKind = {};
  let paragraphs = 0;
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  let index = 0;
  while ((m = paraRe.exec(xml)) !== null) {
    if (tableRanges.some(([a, b]) => m.index >= a && m.index < b)) {
      index++;
      continue;
    }
    const para = m[0];
    const style = (para.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';
    const kind = kinds[index];
    index++;
    if (HEADING_STYLE.test(style)) continue;
    if (kind !== undefined && kind !== 'prose' && kind !== 'reference') continue;
    paragraphs++;
    const jc = para.match(/<w:jc\b[^>]*w:val="([^"]+)"[^>]*\/>/);
    const key = jc ? jc[1] : 'none';
    counts[key] = (counts[key] || 0) + 1;
    const kindKey = kind || 'prose';
    byKind[kindKey] = byKind[kindKey] || { paragraphs: 0, alignments: {} };
    byKind[kindKey].paragraphs++;
    byKind[kindKey].alignments[key] = (byKind[kindKey].alignments[key] || 0) + 1;
  }

  return { paragraphs, counts, byKind };
}
