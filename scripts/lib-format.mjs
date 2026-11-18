// lib-format.mjs — the document formatting rules.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// Six rules, all of them deterministic and all of them reversible by turning
// the matching option off:
//
//   1  citations          "et al." is italic, wherever a citation appears
//   2  tables             every border line is present, and the first row of
//                         cells is aligned top and centred
//   3  cover page         the front page is centred
//   4  line spacing       1.5 lines across the body of the paper
//   5  reference list     justified from the left margin to the right margin
//   6  headings           no italic in a heading, a title or a subtitle
//
// Two kinds of paragraph are left alone by the spacing rule, because stretching
// them is wrong rather than merely unusual: a source-code listing, where the
// spacing is part of the code, and a table cell, where the row height belongs
// to the table and not to the paragraph.
//
// Every element is written in the order the WordprocessingML schema demands.
// Word repairs a file whose elements are out of order, and the repair can drop
// the setting that was being applied.

import { classifySequence, extractGuardRecords } from './lib-guard.mjs';

// 240 twips is one line, 360 is one and a half, 480 is two.
export const SINGLE = 240;
export const ONE_AND_HALF = 360;
export const DOUBLE = 480;

// The Word styles that carry a heading, a title or a caption.
const HEADING_STYLES = /^(Heading\s?[1-6]|Title|Subtitle|Caption|TOC\s?\d)/i;

// ---------------------------------------------------------------------------
// The schema order of the containers this module writes into.
// ---------------------------------------------------------------------------

// CT_PPr, the paragraph properties.
const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
  'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens',
  'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE',
  'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind',
  'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
  'sectPr', 'pPrChange',
];

// CT_RPr, the run properties.
const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike',
  'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid',
  'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz',
  'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign',
  'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath', 'rPrChange',
];

// CT_TcPr, the cell properties.
const TCPR_ORDER = [
  'cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd',
  'noWrap', 'tcMar', 'textDirection', 'tcFitText', 'vAlign', 'hideMark',
  'headers', 'cellIns', 'cellDel', 'cellMerge', 'tcPrChange',
];

// CT_TblPr, the table properties.
const TBLPR_ORDER = [
  'tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize',
  'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders',
  'shd', 'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription',
  'tblPrChange',
];

// ---------------------------------------------------------------------------
// Low level helpers
// ---------------------------------------------------------------------------

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The direct children of a properties element, with their spans.
 *
 * Only the top level children are returned, so the elements inside a nested
 * container such as w:rPr do not confuse the order.
 */
function topLevelChildren(inner) {
  const out = [];
  const re = /<(\/?)w:([A-Za-z]+)\b([^>]*)>/g;
  let m;
  let depth = 0;
  let start = -1;
  let curTag = '';
  while ((m = re.exec(inner)) !== null) {
    const closing = m[1] === '/';
    const selfClosing = m[3].trim().endsWith('/');
    const tag = m[2];
    if (closing) {
      depth--;
      if (depth === 0 && start !== -1) {
        out.push({ tag: curTag, start, end: m.index + m[0].length });
        start = -1;
      }
    } else if (selfClosing) {
      if (depth === 0) out.push({ tag, start: m.index, end: m.index + m[0].length });
    } else {
      if (depth === 0) {
        start = m.index;
        curTag = tag;
      }
      depth++;
    }
  }
  return out;
}

/**
 * Put an element into a properties container, in the order the schema wants.
 *
 * When the element is already there, its value is replaced. Otherwise it is
 * placed before the first child that comes later in the schema, or after the
 * last child that comes earlier.
 */
function insertOrdered(inner, element, order) {
  const name = element.match(/^<w:([A-Za-z]+)/)[1];
  const existingRe = new RegExp(
    '<w:' + name + '\\b[^>]*?(?:/>|>[\\s\\S]*?</w:' + name + '>)'
  );
  if (existingRe.test(inner)) {
    return inner.replace(existingRe, () => element);
  }

  const myPos = order.indexOf(name);
  if (myPos === -1) return inner + element;

  const kids = topLevelChildren(inner);
  let before = -1;
  let after = -1;
  for (const k of kids) {
    const p = order.indexOf(k.tag);
    if (p === -1) continue;
    if (p > myPos) {
      if (before === -1) before = k.start;
    } else if (p < myPos) {
      after = Math.max(after, k.end);
    }
  }

  const at = before !== -1 ? before : after !== -1 ? after : inner.length;
  return inner.slice(0, at) + element + inner.slice(at);
}

/** The paragraph properties of a paragraph element, as an object. */
function pPrParts(para) {
  const selfClosing = para.match(/<w:pPr\s*\/>/);
  if (selfClosing) {
    return {
      present: true,
      inner: '',
      replace: (newInner) =>
        para.replace(selfClosing[0], '<w:pPr>' + newInner + '</w:pPr>'),
    };
  }
  const m = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
  if (m) {
    const inner = m[0].replace(/^<w:pPr>/, '').replace(/<\/w:pPr>$/, '');
    return {
      present: true,
      inner,
      replace: (newInner) =>
        para.replace(m[0], () => '<w:pPr>' + newInner + '</w:pPr>'),
    };
  }
  const open = para.match(/^<w:p\b[^>]*>/);
  if (!open) return { present: false, inner: '', replace: () => para };
  return {
    present: false,
    inner: '',
    replace: (newInner) =>
      para.slice(0, open[0].length) +
      '<w:pPr>' + newInner + '</w:pPr>' +
      para.slice(open[0].length),
  };
}

/** Set the alignment of one paragraph. */
export function setAlignment(para, value) {
  const parts = pPrParts(para);
  const newInner = insertOrdered(
    parts.inner,
    '<w:jc w:val="' + value + '"/>',
    PPR_ORDER
  );
  return parts.replace(newInner);
}

/** Set the line spacing of one paragraph, keeping the before and after spacing. */
export function setLineSpacing(para, twips) {
  const parts = pPrParts(para);
  const sp = parts.inner.match(/<w:spacing\b[^>]*\/>/);
  if (sp) {
    let attrs = sp[0].replace(/^<w:spacing/, '').replace(/\/>$/, '');
    attrs = attrs
      .replace(/\s*w:line="[^"]*"/g, '')
      .replace(/\s*w:lineRule="[^"]*"/g, '');
    const element =
      '<w:spacing' + attrs + ' w:line="' + twips + '" w:lineRule="auto"/>';
    return parts.replace(parts.inner.replace(sp[0], element));
  }
  const element = '<w:spacing w:line="' + twips + '" w:lineRule="auto"/>';
  return parts.replace(insertOrdered(parts.inner, element, PPR_ORDER));
}

/** The alignment a paragraph currently carries, or an empty string. */
export function alignmentOf(para) {
  const m = para.match(/<w:jc\b[^>]*w:val="([^"]+)"/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Run properties
// ---------------------------------------------------------------------------

/** Turn italic on for a run, at the right place in the run properties. */
export function italicOn(rPr) {
  if (!rPr) return '<w:rPr><w:i/></w:rPr>';
  if (/<w:i\s*\/>/.test(rPr)) return rPr;
  if (/<w:i\b[^>]*\/>/.test(rPr)) return rPr.replace(/<w:i\b[^>]*\/>/, '<w:i/>');
  if (rPr === '<w:rPr/>') return '<w:rPr><w:i/></w:rPr>';
  const inner = rPr.replace(/^<w:rPr>/, '').replace(/<\/w:rPr>$/, '');
  return '<w:rPr>' + insertOrdered(inner, '<w:i/>', RPR_ORDER) + '</w:rPr>';
}

/**
 * Turn italic off for a run.
 *
 * The value "0" is used rather than removing the element, because the italic
 * may come from the paragraph style rather than from the run, and only an
 * explicit setting overrides a style.
 */
export function italicOff(rPr) {
  const off = '<w:i w:val="0"/>';
  if (!rPr) return '<w:rPr>' + off + '</w:rPr>';
  if (/<w:i\s*\/>/.test(rPr)) return rPr.replace(/<w:i\s*\/>/, off);
  if (/<w:i\b[^>]*\/>/.test(rPr)) return rPr.replace(/<w:i\b[^>]*\/>/, off);
  if (rPr === '<w:rPr/>') return '<w:rPr>' + off + '</w:rPr>';
  const inner = rPr.replace(/^<w:rPr>/, '').replace(/<\/w:rPr>$/, '');
  return '<w:rPr>' + insertOrdered(inner, off, RPR_ORDER) + '</w:rPr>';
}

/** True when the run properties say the run is italic. */
export function isItalic(rPr) {
  if (!rPr) return false;
  if (/<w:i\b[^>]*w:val="0"/.test(rPr)) return false;
  return /<w:i\s*\/>/.test(rPr) || /<w:i\b[^>]*\/>/.test(rPr);
}

// ---------------------------------------------------------------------------
// Rule 1: "et al." in a citation is italic
// ---------------------------------------------------------------------------

/**
 * Split a run into several runs, so that part of its text can carry a
 * different italic setting.
 *
 * segments is a list of { text, italic }. A run that holds anything other
 * than text, such as a line break, is returned unchanged.
 */
export function splitRun(runXml, segments) {
  const open = runXml.match(/^<w:r\b[^>]*>/);
  if (!open) return runXml;
  const inner = runXml.slice(open[0].length, runXml.length - '</w:r>'.length);

  const rPrMatch = inner.match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/);
  const rPr = rPrMatch ? rPrMatch[0] : '';
  const rest = rPrMatch ? inner.replace(rPrMatch[0], '') : inner;

  const tMatch = rest.match(/^<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>$/);
  if (!tMatch) return runXml;

  const tOpen = '<w:t xml:space="preserve">';
  const parts = segments.map((s) => {
    // A segment may carry its own run properties, which is how the
    // abbreviation is put in roman without touching the rest of the run.
    // A segment with italic null keeps the run properties it had.
    let props;
    if (s.props !== undefined) props = s.props;
    else if (s.italic === null) props = rPr;
    else if (s.italic) props = italicOn(rPr);
    else props = italicOff(rPr);
    return open[0] + props + tOpen + escapeXml(s.text) + '</w:t></w:r>';
  });
  return parts.join('');
}

/**
 * Set the italic state of every "et al." in a paragraph.
 *
 * The text is read across the runs, so an abbreviation split over two runs is
 * still found, and the runs are split so that only the abbreviation is
 * touched. When want is false the abbreviation is put in roman, which is
 * what a style such as APA asks for. The rest of the paragraph keeps the
 * run properties it had.
 */
export function italiciseEtAl(para, want = true) {
  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runRe.exec(para)) !== null) {
    const tMatch = m[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    runs.push({
      start: m.index,
      length: m[0].length,
      xml: m[0],
      text: tMatch ? decodeEntities(tMatch[1]) : null,
    });
  }

  const textRuns = runs.filter((r) => r.text !== null);
  if (!textRuns.length) return para;

  // The offset of every run in the joined text.
  let offset = 0;
  const map = [];
  for (const r of textRuns) {
    map.push({ run: r, start: offset, end: offset + r.text.length });
    offset += r.text.length;
  }
  const full = map.map((x) => x.run.text).join('');

  const ranges = [];
  const re = /\bet\s+al\./gi;
  let hit;
  while ((hit = re.exec(full)) !== null) {
    ranges.push([hit.index, hit.index + hit[0].length]);
  }
  if (!ranges.length) return para;

  // Rebuild the paragraph, run by run.
  const replacements = [];
  for (const entry of map) {
    const r = entry.run;
    const boundaries = new Set([0, r.text.length]);
    for (const [a, b] of ranges) {
      if (b > entry.start && a < entry.end) {
        boundaries.add(Math.max(0, a - entry.start));
        boundaries.add(Math.min(r.text.length, b - entry.start));
      }
    }
    const points = Array.from(boundaries).sort((x, y) => x - y);
    if (points.length < 2) continue;

    const segments = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      if (to <= from) continue;
      const segStart = entry.start + from;
      const segEnd = entry.start + to;
      const inside = ranges.some(([a, b]) => segStart >= a && segEnd <= b);
      segments.push({
        text: r.text.slice(from, to),
        italic: inside ? want : null,
      });
    }
    if (!segments.length) continue;
    const rebuilt = splitRun(r.xml, segments);
    if (rebuilt !== r.xml) replacements.push({ start: r.start, length: r.length, text: rebuilt });
  }

  if (!replacements.length) return para;

  let out = para;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const rep = replacements[i];
    out = out.slice(0, rep.start) + rep.text + out.slice(rep.start + rep.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Element ranges
// ---------------------------------------------------------------------------

/**
 * The ranges of the elements with a given tag, nested ones included.
 *
 * The depth is counted, so a table inside a table cell does not break the
 * search for the outer cell.
 */
export function findElements(xml, tag, from = 0, to = xml.length) {
  const out = [];
  const re = new RegExp('<' + tag + '\\b[^>]*>|</' + tag + '>', 'g');
  re.lastIndex = from;
  let m;
  let depth = 0;
  let start = -1;
  while ((m = re.exec(xml)) !== null) {
    if (m.index >= to) break;
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0 && start !== -1) {
        out.push({ start, end: m.index + m[0].length });
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

/** The top level tables of a document. */
export function findTables(xml) {
  return findElements(xml, 'w:tbl');
}

// ---------------------------------------------------------------------------
// Rule 2: table borders and the first row of cells
// ---------------------------------------------------------------------------

const BORDER_EDGE = (name) =>
  '<w:' + name + ' w:val="single" w:sz="4" w:space="0" w:color="auto"/>';

const ALL_BORDERS =
  '<w:tblBorders>' +
  BORDER_EDGE('top') + BORDER_EDGE('left') + BORDER_EDGE('bottom') +
  BORDER_EDGE('right') + BORDER_EDGE('insideH') + BORDER_EDGE('insideV') +
  '</w:tblBorders>';

const CELL_BORDERS =
  '<w:tcBorders>' +
  BORDER_EDGE('top') + BORDER_EDGE('left') + BORDER_EDGE('bottom') + BORDER_EDGE('right') +
  '</w:tcBorders>';

/**
 * Give every table a full grid of borders, and align the first row of cells
 * to the top and to the centre.
 *
 * The table-level borders are not enough on their own. A cell that carries its
 * own border settings overrides them, and a cell with "none" on its left and
 * right removes the vertical line, which is how a table ends up with only the
 * horizontal rules. The cell borders are set as well, so the grid is complete.
 */
export function formatTables(xml) {
  let tables = 0;
  let cells = 0;
  let headerCells = 0;

  const tableRanges = findTables(xml);
  const edits = [];

  for (const range of tableRanges) {
    tables++;
    let t = xml.slice(range.start, range.end);

    // The table-level borders.
    const tblPr = t.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/);
    if (tblPr) {
      const inner = tblPr[0].replace(/^<w:tblPr>/, '').replace(/<\/w:tblPr>$/, '');
      const newInner = insertOrdered(inner, ALL_BORDERS, TBLPR_ORDER);
      t = t.replace(tblPr[0], () => '<w:tblPr>' + newInner + '</w:tblPr>');
    } else {
      const open = t.match(/^<w:tbl\b[^>]*>/);
      if (open) {
        const at = open[0].length;
        t = t.slice(0, at) + '<w:tblPr>' + ALL_BORDERS + '</w:tblPr>' + t.slice(at);
      }
    }

    // The cells, row by row.
    const rowRanges = findElements(t, 'w:tr');
    const rowEdits = [];
    let rowIndex = 0;

    for (const row of rowRanges) {
      const isFirstRow = rowIndex === 0;
      rowIndex++;
      const tr = t.slice(row.start, row.end);
      const cellRanges = findElements(tr, 'w:tc');
      const cellEdits = [];

      for (const cell of cellRanges) {
        cells++;
        let tc = tr.slice(cell.start, cell.end);

        // The cell borders, so that the vertical rules are not removed.
        const tcPr = tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
        if (tcPr) {
          const inner = tcPr[0].replace(/^<w:tcPr>/, '').replace(/<\/w:tcPr>$/, '');
          const newInner = insertOrdered(inner, CELL_BORDERS, TCPR_ORDER);
          tc = tc.replace(tcPr[0], () => '<w:tcPr>' + newInner + '</w:tcPr>');
        } else {
          const open = tc.match(/^<w:tc\b[^>]*>/);
          if (open) {
            const at = open[0].length;
            tc = tc.slice(0, at) + '<w:tcPr>' + CELL_BORDERS + '</w:tcPr>' + tc.slice(at);
          }
        }

        if (!isFirstRow) {
          cellEdits.push({ start: cell.start, length: cell.end - cell.start, text: tc });
          continue;
        }

        // The first row: the cell is aligned to the top of the row.
        headerCells++;
        const tcPr2 = tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
        if (tcPr2) {
          const inner = tcPr2[0].replace(/^<w:tcPr>/, '').replace(/<\/w:tcPr>$/, '');
          const newInner = insertOrdered(inner, '<w:vAlign w:val="top"/>', TCPR_ORDER);
          tc = tc.replace(tcPr2[0], () => '<w:tcPr>' + newInner + '</w:tcPr>');
        }

        // The text in the first row is centred.
        const paraRanges = findElements(tc, 'w:p');
        const paraEdits = [];
        for (const p of paraRanges) {
          const para = tc.slice(p.start, p.end);
          const updated = setAlignment(para, 'center');
          if (updated !== para) {
            paraEdits.push({ start: p.start, length: p.end - p.start, text: updated });
          }
        }
        for (let i = paraEdits.length - 1; i >= 0; i--) {
          const e = paraEdits[i];
          tc = tc.slice(0, e.start) + e.text + tc.slice(e.start + e.length);
        }

        cellEdits.push({ start: cell.start, length: cell.end - cell.start, text: tc });
      }

      let rowText = tr;
      for (let i = cellEdits.length - 1; i >= 0; i--) {
        const e = cellEdits[i];
        rowText = rowText.slice(0, e.start) + e.text + rowText.slice(e.start + e.length);
      }
      rowEdits.push({ start: row.start, length: row.end - row.start, text: rowText });
    }

    // Put the rows back into the table.
    for (let i = rowEdits.length - 1; i >= 0; i--) {
      const e = rowEdits[i];
      t = t.slice(0, e.start) + e.text + t.slice(e.start + e.length);
    }

    edits.push({ start: range.start, length: range.end - range.start, text: t });
  }

  let out = xml;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.start + e.length);
  }

  return { xml: out, tables, cells, headerCells };
}

// ---------------------------------------------------------------------------
// Rule 3: the cover page is centred
// ---------------------------------------------------------------------------

/**
 * Split a paragraph at a page break, so that the text after the break can be
 * left alone while the text before it is treated as the cover.
 *
 * Returns null when the paragraph does not need to be split.
 */
export function splitAtPageBreak(para) {
  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let m;
  while ((m = runRe.exec(para)) !== null) {
    const run = m[0];
    if (!/<w:br\b[^>]*w:type="page"/.test(run)) continue;

    // The break is at the end of a run that also holds text, so the text
    // belongs to the page before the break.
    const breakAt = run.indexOf('<w:br');
    const hasTextBefore = /<w:t\b[^>]*>[^<]*\S/.test(run.slice(0, breakAt));
    const cut = hasTextBefore ? m.index + run.length : m.index;

    const after = para.slice(cut);
    const afterText = after.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    const hasTextAfter = afterText.some((t) => decodeEntities(t.replace(/<[^>]*>/g, '')).trim() !== '');
    if (!hasTextAfter) return null;

    const open = para.match(/^<w:p\b[^>]*>/);
    const pPr = para.match(/<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/);
    const first = para.slice(0, cut) + '</w:p>';
    const second = open[0] + (pPr ? pPr[0] : '') + after;
    return { first, second };
  }
  return null;
}

/**
 * Find the paragraphs that make up the cover page.
 *
 * The cover ends at the first explicit page break. When the document has no
 * page break, the cover ends at the first paragraph of ordinary prose.
 */
export function coverRange(xml, kinds) {
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const paras = [];
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    paras.push({ start: m.index, length: m[0].length, xml: m[0] });
  }

  for (let i = 0; i < paras.length; i++) {
    if (/<w:br\s+w:type="page"/.test(paras[i].xml) || /<w:br\b[^>]*w:type="page"/.test(paras[i].xml)) {
      return { from: 0, to: i, byPageBreak: true };
    }
  }

  for (let i = 0; i < paras.length; i++) {
    if (kinds[i] === 'prose') return { from: 0, to: i - 1, byPageBreak: false };
  }
  return { from: 0, to: -1, byPageBreak: false };
}

// ---------------------------------------------------------------------------
// Rule 6: no italic in a heading, a title or a subtitle
// ---------------------------------------------------------------------------

/**
 * Turn the italic off for every run in a paragraph.
 *
 * When the paragraph uses a heading or a title style, the italic may come from
 * that style, and only an explicit setting overrides a style, so every text run
 * is given the setting even when it carries no italic of its own.
 *
 * When the paragraph was recognised from its content and uses no style, the
 * italic can only come from a run, so only the runs that really are italic are
 * touched. That keeps the pass stable when it runs a second time.
 */
export function stripItalic(para, options = {}) {
  const force = options.force === true;
  return para.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const rPrMatch = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/);
    if (rPrMatch) {
      const off = italicOff(rPrMatch[0]);
      if (off === rPrMatch[0]) return run;
      return run.replace(rPrMatch[0], () => off);
    }
    if (!force) return run;
    const open = run.match(/^<w:r\b[^>]*>/);
    if (!open) return run;
    const hasText = /<w:t(?:\s[^>]*)?>[^<]*\S/.test(run);
    if (!hasText) return run;
    const at = open[0].length;
    return run.slice(0, at) + '<w:rPr><w:i w:val="0"/></w:rPr>' + run.slice(at);
  });
}

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

export const DEFAULT_OPTIONS = {
  justify: true,
  justifyReferences: true,
  lineSpacing: ONE_AND_HALF,
  coverCentred: true,
  tableBorders: true,
  tableHeaderAligned: true,
  headingItalicOff: true,
  citationItalics: true,
};

/**
 * Apply every formatting rule to a WordprocessingML document.
 *
 * Returns the new XML and a report of what was changed.
 */
export function applyFormatting(xml, options = {}) {
  const opts = Object.assign({}, DEFAULT_OPTIONS, options);
  const report = {
    tables: 0,
    cells: 0,
    headerCells: 0,
    coverParagraphs: 0,
    justified: 0,
    referencesJustified: 0,
    spaced: 0,
    headingsDeItalicised: 0,
    citationsItalicised: 0,
    coverSplit: 0,
  };

  let out = xml;

  // The page break that ends the cover is split out first, so that the text
  // after it is never mistaken for part of the cover.
  if (opts.coverCentred) {
    const split = splitFirstCoverBreak(out);
    if (split) {
      out = split.xml;
      report.coverSplit = 1;
    }
  }

  // The tables are done next, because the table work changes the XML and the
  // paragraph offsets that come after it.
  if (opts.tableBorders || opts.tableHeaderAligned) {
    const tables = formatTables(out);
    out = tables.xml;
    report.tables = tables.tables;
    report.cells = tables.cells;
    report.headerCells = tables.headerCells;
  }

  const records = extractGuardRecords(out);
  const kinds = classifySequence(records);

  // The table ranges are taken from the current XML, so that the offsets
  // agree with the paragraph scan that follows.
  const tableRanges = findTables(out);

  const cover = opts.coverCentred ? coverRange(out, kinds) : { from: 0, to: -1 };

  const edits = [];
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  let index = 0;
  while ((m = paraRe.exec(out)) !== null) {
    const para = m[0];
    const kind = kinds[index];
    const style = (para.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';
    const inTable = tableRanges.some((r) => m.index >= r.start && m.index < r.end);
    const onCover = index >= cover.from && index <= cover.to;
    index++;

    let next = para;

    // Rule 3: the cover page is centred.
    if (onCover && !inTable) {
      next = setAlignment(next, 'center');
      report.coverParagraphs++;
    }

    // The body rule and rule 5: justification.
    if (!inTable && !onCover) {
      if (kind === 'prose' && opts.justify) {
        next = setAlignment(next, 'both');
        report.justified++;
      }
      if (kind === 'reference' && opts.justifyReferences) {
        next = setAlignment(next, 'both');
        report.referencesJustified++;
      }
    }

    // Rule 4: line spacing. A code listing and a table cell keep their own
    // spacing, because stretching them is wrong rather than merely unusual.
    if (opts.lineSpacing && !inTable && kind !== 'code') {
      const before = next;
      next = setLineSpacing(next, opts.lineSpacing);
      if (before !== next) report.spaced++;
    }

    // Rule 6: no italic in a heading, a title or a subtitle.
    //
    // The Word styles Heading 1 to Heading 6, Title, Subtitle and Caption
    // are all reported as a heading or a title by the guard, so they are
    // covered here. A caption that was recognised from its content keeps its
    // italic, because that is how a table caption is written.
    if (opts.headingItalicOff && (kind === 'heading' || kind === 'title')) {
      const before = next;
      next = stripItalic(next, { force: HEADING_STYLES.test(style) });
      if (before !== next) report.headingsDeItalicised++;
    }

    // Rule 1: "et al." in a citation is italic or roman, as the style of
    // the journal asks. The default is italic, which is the form most
    // engineering journals ask for; a style that wants roman says so.
    const citationEtAl = opts.citationEtAl === undefined ? 'italic' : opts.citationEtAl;
    if (citationEtAl !== 'keep' && kind !== 'code') {
      const before = next;
      next = italiciseEtAl(next, citationEtAl === 'italic');
      if (before !== next) report.citationsItalicised++;
    }

    if (next !== para) {
      edits.push({ start: m.index, length: para.length, text: next });
    }
  }

  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.start + e.length);
  }

  return { xml: out, report };
}

/**
 * Split the paragraph that carries the first page break, when there is text
 * after the break in the same paragraph.
 */
function splitFirstCoverBreak(xml) {
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    if (!/<w:br\b[^>]*w:type="page"/.test(m[0])) continue;
    const split = splitAtPageBreak(m[0]);
    if (!split) return null;
    const out = xml.slice(0, m.index) + split.first + split.second + xml.slice(m.index + m[0].length);
    return { xml: out };
  }
  return null;
}
