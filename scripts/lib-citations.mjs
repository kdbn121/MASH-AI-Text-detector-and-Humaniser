// lib-citations.mjs -- citations, reference lists and the rules of a style.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// WHY THIS FILE EXISTS
//
// A paper is not finished when the prose is right. It is finished when every
// citation in the body points at an entry in the reference list, every entry
// in the reference list is cited, every link resolves, and the whole of it
// obeys one style guide from the first page to the last.
//
// This module does four things and refuses to do a fifth:
//
//   1  it reads the in-text citations out of a document
//   2  it reads the reference list out of a document
//   3  it matches one against the other and reports what does not line up
//   4  it checks the links and the style rules
//
// It never invents a citation, a reference, a DOI or a URL. A missing
// reference is reported as missing. A broken link is reported as broken. The
// one thing an engine must not do is write a DOI that looks right and is
// wrong, because a wrong DOI is a claim about the literature that no reader
// can check and every reader will trust.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Load the citation style bank. */
export function loadStyleBank(dir) {
  const path = join(dir, 'citation_styles.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const styles = raw.styles || raw;
  return {
    styles,
    names: Object.keys(styles),
    get(name) {
      if (!name) return null;
      const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [k, v] of Object.entries(styles)) {
        if (k.toLowerCase() === key) return { key: k, ...v };
      }
      for (const [k, v] of Object.entries(styles)) {
        const label = String(v.label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (label && label.startsWith(key)) return { key: k, ...v };
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Reading the in-text citations
// ---------------------------------------------------------------------------

// The words that open a parenthetical citation but are not part of it.
const CONNECTIVE = /^(?:see|also see|e\.g\.|i\.e\.|cf\.|compare|and)\s+/i;

// The words that look like a surname but never are one at the start of a
// narrative citation.
const NOT_A_SURNAME = new Set([
  'table', 'figure', 'fig', 'section', 'chapter', 'equation', 'eq', 'volume',
  'vol', 'no', 'note', 'appendix', 'case', 'step', 'part', 'line', 'page',
  'pages', 'p', 'pp', 'in', 'the', 'this', 'these', 'those', 'such', 'since',
  'while', 'when', 'if', 'although', 'because', 'however', 'therefore',
  'moreover', 'finally', 'first', 'second', 'third', 'also', 'both', 'each',
  'every', 'many', 'most', 'some', 'several', 'its', 'their', 'our', 'his',
  'her', 'it', 'they', 'we', 'he', 'she', 'you', 'one', 'two', 'three', 'four',
  'five', 'as', 'for', 'from', 'with', 'without', 'within', 'during', 'after',
  'before', 'under', 'over', 'between', 'among', 'through', 'using', 'based',
  'given', 'due', 'according', 'regarding', 'concerning', 'following',
  'prior', 'unlike', 'per', 'via', 'a', 'an', 'at', 'by', 'on', 'to', 'of',
  'and', 'but', 'or', 'so', 'nor', 'yet', 'not', 'no', 'only', 'same',
  'such', 'both', 'all', 'further', 'later', 'hence', 'thus', 'indeed',
]);

/** Split a piece of text into the names a citation can be made of. */
function surnameTokens(block) {
  const pieces = block
    .split(/\s*(?:,|\||;|\band\b|&)\s*/i)
    .map((s) => s.trim().replace(/\.$/, ''))
    .filter(Boolean);
  const kept = pieces.filter((s) => {
    if (!/^[A-Z]/.test(s)) return false;
    if (!/^[A-Z][A-Za-z'’\-]*(?:\s+[A-Z][A-Za-z'’\-]*)*$/.test(s)) return false;
    const first = s.split(/\s+/)[0].toLowerCase();
    return !NOT_A_SURNAME.has(first);
  });
  if (kept.length) return kept;
  // An organisation such as "Aerospace Global News" is one name.
  const whole = block.trim().replace(/[,;.]+$/, '').trim();
  if (/^[A-Z][A-Za-z'’\-]*(?:\s+[A-Z][A-Za-z'’\-]*)*$/.test(whole)) {
    const first = whole.split(/\s+/)[0].toLowerCase();
    if (!NOT_A_SURNAME.has(first)) return [whole];
  }
  return [];
}

/**
 * Read one half of a parenthetical citation.
 *
 * "Gryte et al., 2022" gives the surname Gryte, the year 2022 and the
 * abbreviation. "Smith and Jones, 2024, p. 45" gives two surnames and a
 * locator. A year that is not there, as in the MLA form "(Smith et al. 45)",
 * gives a locator instead.
 */
function parseCitationPart(part) {
  const raw = part.trim();
  if (!raw) return null;
  const yearMatch = raw.match(/\b(\d{4}[a-z]?)\b/);
  const year = yearMatch ? yearMatch[1] : null;

  // The punctuation between the name and the year is removed before the
  // abbreviation is looked for, because "Bragg et al., 2005" carries a comma
  // after the abbreviation and the abbreviation is still there.
  let head = (yearMatch ? raw.slice(0, yearMatch.index) : raw).trim();
  head = head.replace(/[,;:.]+$/, '').trim();

  const etalMatch = head.match(/\bet\s+al\.?$/i);
  const etal = !!etalMatch;
  const authorBlock = (etalMatch ? head.slice(0, etalMatch.index) : head)
    .replace(CONNECTIVE, '')
    .trim();
  const authors = surnameTokens(authorBlock);
  if (!authors.length) return null;

  let locator = null;
  if (!year) {
    const locMatch = raw.match(/\b(p{1,2}\.\s*)?(\d+)\s*$/);
    if (locMatch) locator = locMatch[2];
    else return null;
  }
  const tail = yearMatch ? raw.slice(yearMatch.index + yearMatch[1].length).trim() : '';
  return { raw, authors, authorBlock, year, etal, locator, tail };
}

/**
 * Read every in-text citation out of a piece of text.
 *
 * Two forms are recognised. A parenthetical citation is a bracket with an
 * author and a year inside it, and a narrative citation is a name followed
 * by a year in brackets. A bracket that holds a year and nothing else is
 * left to the narrative form, so that "Gryte et al. (2022)" is counted once
 * and not twice.
 */
export function parseCitations(text) {
  const found = [];

  const parenRe = /\(([^()]{3,300})\)/g;
  let m;
  while ((m = parenRe.exec(text)) !== null) {
    const inside = m[1];
    // A bracket that holds only a year belongs to a narrative citation.
    if (/^\s*\d{4}[a-z]?\s*$/.test(inside)) continue;
    const parts = inside.split(';');
    for (const part of parts) {
      const parsed = parseCitationPart(part);
      if (!parsed) continue;
      found.push({
        form: 'parenthetical',
        at: m.index + m[0].indexOf(part),
        text: m[0],
        ...parsed,
      });
    }
  }

  const narrativeRe = new RegExp(
    '\\b([A-Z][A-Za-z\'’\\-]+(?:\\s+(?:&|and)\\s+[A-Z][A-Za-z\'’\\-]+)?)' +
    '\\s+(et\\s+al\\.?)?\\s*\\((\\d{4}[a-z]?)\\)',
    'g'
  );
  while ((m = narrativeRe.exec(text)) !== null) {
    const surname = m[1].split(/\s*(?:&|\band\b)\s*/)[0].trim();
    if (!surname || NOT_A_SURNAME.has(surname.toLowerCase())) continue;
    found.push({
      form: 'narrative',
      at: m.index,
      text: m[0],
      raw: m[0],
      authors: [surname],
      authorBlock: surname,
      year: m[3],
      etal: !!m[2],
      locator: null,
      tail: '',
    });
  }

  found.sort((a, b) => a.at - b.at);
  return found;
}

/** Read the numeric citations, the "[1]" and "[2, 3]" form. */
export function parseNumericCitations(text) {
  const found = [];
  const re = /\[(\d+(?:\s*[,\-–]\s*\d+)*)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const numbers = [];
    for (const piece of m[1].split(/\s*,\s*/)) {
      const range = piece.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) numbers.push(String(i));
      } else if (/^\d+$/.test(piece)) {
        numbers.push(piece);
      }
    }
    if (!numbers.length) continue;
    found.push({ form: 'numeric', at: m.index, text: m[0], numbers });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Reading the reference list
// ---------------------------------------------------------------------------

/**
 * The names an author block can be called by.
 *
 * A block such as "Gryte, K., Kleiven, R., & Johansen, T. A." gives the name
 * Gryte. A block such as "Beheshti Rabiei, A., ..." gives a name with two
 * parts, and the text may call its author by either of them. A block such as
 * "Aerospace Global News." gives an organisation, and the text calls it by
 * its whole name. All of the forms are listed, so that a citation can be
 * matched against a reference whichever way the writer shortened it.
 */
export function nameCandidates(block) {
  if (!block) return [];
  const clean = block
    .replace(/^\s*\[\d+\]\s*/, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\bet\s+al\.?/gi, '')
    .trim();
  if (!clean) return [];

  const candidates = new Set();
  const firstBlock = clean.split(/,|\||;/)[0].trim();
  const words = firstBlock.split(/\s+/).filter(Boolean);
  if (words.length) {
    // The last part of a compound name, on its own: "Rabiei".
    candidates.add(normaliseName(words[words.length - 1]));
    // The first part of it, on its own: "Beheshti".
    candidates.add(normaliseName(words[0]));
    // The whole of it: "beheshtirabiei".
    candidates.add(normaliseName(words.join('')));
  }
  // The whole organisation, for a reference such as "Aerospace Global News".
  const organisation = clean.split(/\(\d{4}|\bet\s+al\.?/i)[0].trim();
  if (organisation && organisation.length <= 80) {
    candidates.add(normaliseName(organisation.replace(/[.,]+$/, '')));
  }
  return [...candidates].filter((c) => c.length > 1);
}

/** Reduce a name to the letters that matter for matching. */
function normaliseName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * True when a citation name and a reference name are the same name.
 *
 * An exact match always counts. A shorter name counts as the same when it
 * is the beginning of a longer one and is long enough not to be a
 * coincidence, so that "Aerospace" matches "Aerospace Global News".
 */
export function sameName(citationNames, referenceNames) {
  for (const c of citationNames) {
    for (const r of referenceNames) {
      if (c === r) return true;
      if (c.length >= 5 && r.length >= 5 && (r.startsWith(c) || c.startsWith(r))) return true;
    }
  }
  return false;
}

/** The first surname of an author block. */
export function firstSurname(block) {
  const candidates = nameCandidates(block);
  return candidates.length ? candidates[0] : null;
}

/**
 * Read one reference entry.
 *
 * Two shapes are recognised. An author-date entry gives the authors, then
 * the year in brackets or after a full stop. A numeric entry gives a number
 * in square brackets and keeps the year wherever the style puts it, which is
 * why the year is looked for from the end backwards.
 */
export function parseReference(raw, index) {
  const text = String(raw || '').trim();
  if (!text) return null;

  let number = null;
  const numMatch = text.match(/^\s*\[(\d+)\]|^\s*(\d+)\.\s/);
  if (numMatch) number = numMatch[1] || numMatch[2];

  let year = null;
  let authorsBlock = null;

  const bracketed = text.match(/^(.+?)\s*\(((\d{4})[a-z]?)\)/);
  const dotted = text.match(/^(.+?)[,.]?\s+(\d{4})[a-z]?\s*[.,]/);
  if (bracketed) {
    authorsBlock = bracketed[1];
    year = bracketed[2];
  } else if (dotted && text.length < 400) {
    authorsBlock = dotted[1];
    year = dotted[2];
  } else {
    const years = [...text.matchAll(/\b(\d{4})[a-z]?\b/g)];
    if (years.length) {
      year = years[years.length - 1][1];
      authorsBlock = text.slice(0, years[years.length - 1].index);
    }
  }

  const surname = firstSurname(authorsBlock || text);
  const doi = extractDoi(text);
  const url = extractUrl(text);
  const etal = /\bet\s+al\./i.test(authorsBlock || '');
  const authorCount = countAuthors(authorsBlock || '');

  return {
    index,
    number,
    raw: text,
    surname,
    names: nameCandidates(authorsBlock || text),
    year,
    authorsBlock: authorsBlock ? authorsBlock.trim() : null,
    authorCount,
    etal,
    doi,
    url,
  };
}

/**
 * How many authors an author block names.
 *
 * The block is counted by the names it holds, not by the commas, because a
 * block such as "Gryte, K., Kleiven, R., & Johansen, T. A." carries three
 * names and five commas.
 */
export function countAuthors(block) {
  if (!block) return 0;
  const cleaned = block
    .replace(/\bet\s+al\.?/gi, '')
    .replace(/\band\b/gi, '&')
    .replace(/[^A-Za-z&,'’.\s-]/g, ' ');
  const pieces = cleaned
    .split(/\s*(?:,|&)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  let names = 0;
  for (const piece of pieces) {
    // A bare initial is the given name of the name before it, not a name of
    // its own.
    if (/^(?:[A-Z]\.?|[A-Z]\.\s*[A-Z]\.?)$/.test(piece)) continue;
    if (!/^[A-Z]/.test(piece)) continue;
    names++;
  }
  return names;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"'<>]+)/g;

/** Every DOI in a piece of text. */
export function extractDoi(text) {
  const hits = [];
  let m;
  while ((m = DOI_RE.exec(text)) !== null) {
    hits.push({ doi: m[1], at: m.index });
  }
  DOI_RE.lastIndex = 0;
  return hits;
}

/** Every http or https address in a piece of text. */
export function extractUrl(text) {
  const hits = [];
  const re = /\bhttps?:\/\/[^\s"'<>\])]+/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ url: m[0], at: m.index });
  }
  return hits;
}

/**
 * Check a DOI against the shape a DOI has to have.
 *
 * This is a check of syntax, not of truth. It says that the string is a
 * well-formed DOI and nothing more. Whether the DOI points at the paper the
 * author means is a question for the network, and the engine asks the network
 * only when the user asks it to.
 */
export function validateDoi(doi) {
  const value = String(doi || '').trim().replace(/[.,;]+$/, '');
  if (!value) return { ok: false, reason: 'empty' };
  if (!/^10\.\d{4,9}\/\S+$/.test(value)) {
    if (!/^10\./.test(value)) return { ok: false, reason: 'does not begin with the prefix 10.' };
    if (!/\//.test(value)) return { ok: false, reason: 'has no suffix after the slash' };
    const prefix = value.split('/')[0].slice(3);
    if (!/^\d{4,9}$/.test(prefix)) return { ok: false, reason: 'the registrant code has to be four to nine digits' };
    return { ok: false, reason: 'the suffix holds a character a DOI cannot hold' };
  }
  return { ok: true, doi: value, reason: 'well-formed' };
}

/**
 * Check a web address against the shape a web address has to have.
 *
 * Again this is a check of syntax. A link can be perfectly well formed and
 * still be dead, and only the network can say which.
 */
export function validateUrl(url) {
  const value = String(url || '').trim().replace(/[.,;]+$/, '');
  if (!value) return { ok: false, reason: 'empty' };
  let parsed;
  try {
    parsed = new URL(value);
  } catch (err) {
    return { ok: false, reason: 'not a valid address' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'the scheme is ' + parsed.protocol.replace(':', '') + ', not http or https' };
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    return { ok: false, reason: 'the host name has no domain part' };
  }
  return { ok: true, url: value, reason: 'well-formed' };
}

// ---------------------------------------------------------------------------
// Matching the two halves
// ---------------------------------------------------------------------------

/**
 * True when a reference entry is a note to the writer rather than a source.
 *
 * A placeholder such as "Karli, G., et al. (2024). [Add full author list,
 * title and DOI for this reference.]" is not a reference. It has to be
 * found, because a reader who follows it finds nothing.
 */
export function isPlaceholderReference(raw) {
  const text = String(raw || '');
  if (!text) return false;
  if (/\[\s*(?:add|insert|complete|fill|todo|tbc|missing|insert full|provide)\b/i.test(text)) return true;
  if (/\b(?:full reference|full author list|title and doi|to be completed|not found)\b/i.test(text)) return true;
  if (/\bXXX\b|\bTBD\b|\?\?\?/.test(text)) return true;
  return false;
}

/** The key an author-date citation and its reference share. */
export function authorDateKey(surname, year) {
  if (!surname || !year) return null;
  return surname.toLowerCase() + '|' + year;
}

/**
 * Match the in-text citations against the reference list.
 *
 * An author-date style matches on the surname of the first author and the
 * year. A numeric style matches on the number. A citation whose year is not
 * in the reference list is a missing reference; a reference that no citation
 * points at is an unused reference. Both are reported, and neither is
 * guessed at.
 */
export function crossCheck(citations, references, style) {
  const missing = [];
  const usedRefs = new Set();

  if (style.family === 'numeric') {
    const byNumber = new Map();
    for (const ref of references) {
      if (ref.number && !byNumber.has(String(ref.number))) byNumber.set(String(ref.number), ref);
    }
    for (const cite of citations) {
      let found = false;
      for (const n of cite.numbers || []) {
        const ref = byNumber.get(String(n));
        if (ref) {
          usedRefs.add(ref);
          found = true;
        }
      }
      if (!found) {
        missing.push({ citation: cite, reason: 'no entry with this number in the reference list' });
      }
    }
    const unused = references.filter((r) => !usedRefs.has(r));
    return { missing, unused, matched: usedRefs.size };
  }

  // An author-date style. The year has to agree, and the name has to be one
  // of the names the reference can be called by.
  const unused = [];
  for (const ref of references) {
    let cited = false;
    for (const cite of citations) {
      if (!cite.year || !ref.year) continue;
      if (String(cite.year).replace(/[a-z]$/, '') !== String(ref.year).replace(/[a-z]$/, '')) continue;
      const citeNames = nameCandidates(cite.authorBlock || cite.authors.join(' '));
      if (sameName(citeNames, ref.names || [])) {
        cited = true;
        break;
      }
    }
    if (!cited) unused.push(ref);
  }

  for (const cite of citations) {
    let found = false;
    for (const ref of references) {
      if (!cite.year || !ref.year) continue;
      if (String(cite.year).replace(/[a-z]$/, '') !== String(ref.year).replace(/[a-z]$/, '')) continue;
      const citeNames = nameCandidates(cite.authorBlock || cite.authors.join(' '));
      if (sameName(citeNames, ref.names || [])) {
        found = true;
        break;
      }
    }
    if (!found) {
      const surname = (cite.authors && cite.authors[0]) || 'the source';
      missing.push({
        citation: cite,
        reason: cite.year
          ? 'no entry for ' + surname + ' (' + cite.year + ') in the reference list'
          : 'no entry for ' + surname + ' in the reference list',
      });
    }
  }

  return { missing, unused, matched: references.length - unused.length };
}

// ---------------------------------------------------------------------------
// The rules of a style
// ---------------------------------------------------------------------------

/**
 * Check the citations and the reference list against the rules of a style.
 *
 * Every rule is checked against something that can be read from the
 * document: the number of names a citation gives, the comma before the
 * year, the number of names a reference lists before the abbreviation, and
 * the presence of a link.
 */
export function styleViolations(citations, references, style, referenceMap) {
  const problems = [];

  for (const cite of citations) {
    if (cite.form === 'numeric') continue;
    const key = authorDateKey(cite.authors[0], cite.year);
    const ref = referenceMap ? referenceMap.get(key) : null;

    if (cite.etal && style.inTextEtaAfter > 0 && ref && ref.authorCount > 0) {
      if (ref.authorCount < style.inTextEtaAfter) {
        problems.push({
          kind: 'etal-too-early',
          severity: 'error',
          citation: cite,
          message: 'the abbreviation is used for ' + ref.authorCount + ' author(s), and the style allows it only from ' +
            style.inTextEtaAfter + ' onwards',
        });
      }
    }
    if (!cite.etal && style.inTextEtaAfter > 0 && ref && ref.authorCount > style.inTextEtaAfter) {
      problems.push({
        kind: 'etal-missing',
        severity: 'warn',
        citation: cite,
        message: 'the reference holds ' + ref.authorCount + ' authors and the text names them all, where the style asks for the abbreviation from ' +
          style.inTextEtaAfter + ' onwards',
      });
    }
    if (style.commaBeforeYear && cite.form === 'parenthetical' && cite.year) {
      const head = cite.raw.replace(/\s+/g, ' ');
      if (/\bet\s+al\.?\s+\d{4}/i.test(head) || /\b[A-Za-z'’\-]+\s+\d{4}/.test(head)) {
        if (!/,\s*\d{4}/.test(head) && /\d{4}/.test(head)) {
          problems.push({
            kind: 'missing-comma',
            severity: 'error',
            citation: cite,
            message: 'the style puts a comma between the name and the year inside brackets',
          });
        }
      }
    }
  }

  for (const ref of references) {
    if (isPlaceholderReference(ref.raw)) {
      problems.push({
        kind: 'placeholder-reference',
        severity: 'error',
        reference: ref,
        message: 'the entry is a placeholder and has to be completed before the paper is sent',
      });
    }
    if (style.referenceEtaAfter > 0 && ref.authorCount > style.referenceEtaAfter + 1) {
      problems.push({
        kind: 'reference-etal-count',
        severity: 'error',
        reference: ref,
        message: 'the reference lists ' + ref.authorCount + ' names where the style asks for ' +
          style.referenceEtaAfter + ' and then the abbreviation',
      });
    }
    if (style.referenceEtaAfter > 0 && ref.etal && ref.authorCount > style.referenceEtaAfter + 1) {
      problems.push({
        kind: 'reference-etal-count',
        severity: 'error',
        reference: ref,
        message: 'the reference lists ' + ref.authorCount + ' names before the abbreviation, where the style asks for ' +
          style.referenceEtaAfter,
      });
    }
    if (style.doiRequired && !ref.doi && !ref.url) {
      problems.push({
        kind: 'missing-doi',
        severity: 'warn',
        reference: ref,
        message: 'the style asks for a link and this entry has none',
      });
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// The italic state of the abbreviation
// ---------------------------------------------------------------------------

/**
 * Find every "et al." in a Word document and say whether it is italic.
 *
 * The answer is read from the run properties, so a style that wants the
 * abbreviation in roman can be told that it is in italic and the other way
 * round.
 */
export function findEtAlFormatting(xml) {
  const results = [];
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let p;
  while ((p = paraRe.exec(xml)) !== null) {
    const para = p[0];
    const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    const runs = [];
    let r;
    while ((r = runRe.exec(para)) !== null) {
      const tMatch = r[0].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
      const rPrMatch = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\s*\/>/);
      const rPr = rPrMatch ? rPrMatch[0] : '';
      const italic = /<w:i\s*\/>/.test(rPr) && !/<w:i\b[^>]*w:val="0"/.test(rPr);
      runs.push({ start: r.index, length: r[0].length, xml: r[0], rPr, italic, text: tMatch ? tMatch[1] : null });
    }
    const textRuns = runs.filter((x) => x.text !== null);
    if (!textRuns.length) continue;
    let offset = 0;
    const map = [];
    for (const run of textRuns) {
      map.push({ run, start: offset, end: offset + run.text.length });
      offset += run.text.length;
    }
    const full = map.map((x) => x.run.text).join('');
    const re = /\bet\s+al\./gi;
    let hit;
    while ((hit = re.exec(full)) !== null) {
      const at = hit.index;
      const covering = map.filter((x) => x.end > at && x.start < at + hit[0].length);
      const italic = covering.length > 0 && covering.every((x) => x.run.italic);
      results.push({
        paragraph: p.index,
        at,
        text: hit[0],
        italic,
        mixed: covering.length > 0 && covering.some((x) => x.run.italic) && covering.some((x) => !x.run.italic),
      });
    }
  }
  return results;
}

/** The style bank lives beside the other banks. */
export function styleDir(rulesDir) {
  const path = join(rulesDir, 'citation_styles.json');
  return existsSync(path) ? rulesDir : null;
}
