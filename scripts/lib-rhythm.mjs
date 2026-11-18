// lib-rhythm.mjs -- the cadence of a passage.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.
//
// WHY THIS FILE EXISTS
//
// A commercial AI detector reads the rhythm of a document before it reads
// anything else. One of the four signals its vendors publish is burstiness:
// the amount by which sentence length varies. A person writing an argument
// moves between a long clause-heavy sentence and a short blunt one, and the
// variation is visible over a stretch of a paragraph. A language model holds
// a steadier cadence, and holds it for paragraphs at a time.
//
// A steady cadence is not a crime. It is, however, the shape that classifiers
// are built to recognise, and it is the one part of the signal a careful
// writer can change without changing a single fact.
//
// This module offers three meaning-preserving repairs:
//
//   repairCadence  splits a long sentence or fuses two short ones, so that a
//                  paragraph stops holding one note.
//   frontClause   moves a trailing subordinate clause to the front of its
//                  sentence, so that two sentences in a row stop opening with
//                  the same words.
//   openerKey     the first words of a sentence, used to find the collisions.
//
// Nothing here invents content, changes a number, or reorders an argument.
// A repair that cannot be proved safe is not performed.

/** Count the words of a string in the same way the detector proxy counts them. */
export function wordCount(s) {
  return (s.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
}

/** Mean, standard deviation and coefficient of variation of a list. */
export function cadenceStats(lengths) {
  if (!lengths.length) return { mean: 0, sd: 0, cv: 0 };
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lengths.length;
  const sd = Math.sqrt(variance);
  return { mean, sd, cv: mean ? sd / mean : 0 };
}

/** The first words of a sentence, in lower case. */
export function openerKey(sentence, n = 2) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ').toLowerCase().replace(/[^a-z0-9\s'-]/g, '');
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

// The separators that can stand between two independent clauses.
//
// A comma before "and" is the author's own signal that two independent
// clauses follow, so that is the cut that is offered first. A causal "so" is
// offered second, because the link it carries is still clear from the two
// clauses once they stand apart. A relative clause is not on the list, and
// neither is a contrastive "but": "X, but Y" carries a surprise that a full
// stop would throw away.
const SEPARATORS = [
  ', and ',
  ', so ',
];

// A sentence that carries a list is left alone. A colon introduces the list
// and a full stop inside it would break the items away from their lead-in.
const LIST_MARKER_RE = /\(\d{1,2}\)|\b\d{1,2}\.\s+[A-Z]/;

// The right half of a split has to carry a subject of its own. When it opens
// on a verb, the two halves share the subject of the sentence, and cutting
// there leaves the second half without one: "All metrics are defined against
// the reference and are computed over a 15 s horizon" cannot become
// "All metrics are defined against the reference. Are computed over a 15 s
// horizon".
const VERB_START =
  /^(?:is|are|was|were|be|been|being|do|does|did|has|have|had|can|could|will|would|shall|should|must|may|might|not|and|or|but|so|yet|nor|also|then|thus|hence|therefore)\b/i;

// A subject of its own: a determiner, a quantifier, a pronoun or a name.
const SUBJECT_START =
  /^(?:the|a|an|this|that|these|those|its|their|our|his|her|my|your|some|most|many|several|few|each|every|both|all|no|one|two|three|four|five|six|seven|eight|nine|ten|it|they|we|he|she|there|such|another|such|people|researchers|studies|results|models|systems|data|aircraft|icing|control)\b/;

// The left half of a split has to open on a subject as well. "4%, peak
// elevator demand is 31% higher" is the tail of a sentence, and a sentence
// cannot begin with it.
const LEFT_START =
  /^(?:the|a|an|this|that|these|those|its|their|our|his|her|my|your|some|most|many|several|few|each|every|both|all|no|one|two|three|four|five|six|seven|eight|nine|ten|it|they|we|he|she|there|such|another|first|second|third|fourth|fifth|finally|next|in|on|at|for|with|from|by|as|when|while|after|before|since|if|unless|under|over|during|through|based|using|within|across|between|among|afterwards|here|now|then|thus|hence)\b/i;

function balanced(text) {
  let open = 0;
  for (const ch of text) {
    if (ch === '(') open++;
    else if (ch === ')') {
      open--;
      if (open < 0) return false;
    }
  }
  return open === 0;
}

/**
 * Blank out the text inside brackets, keeping the length.
 *
 * A citation such as "(Heramarwan et al., 2023; Rizzi & Rizzi, 2022)" holds a
 * semicolon and a comma that have nothing to do with the sentence around it.
 * The masked copy is used to decide whether a sentence carries a list, and to
 * find the place to cut it, so that a citation is never cut in half.
 */
export function maskBrackets(text) {
  const chars = text.split('');
  let depth = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) chars[i] = 'x';
  }
  return chars.join('');
}

/**
 * Find a safe place to cut a sentence into two independent sentences.
 *
 * Returns { left, right, at } or null. A cut is only offered when both sides
 * carry a finite verb of their own, which is what makes them two sentences
 * rather than a sentence and a fragment.
 */
export function splitCandidate(sentence, opts = {}) {
  const isClause = opts.isClause || (() => true);
  const verbIndex = opts.verbIndex || null;
  const text = sentence.trim();
  if (text.length < 60) return null;
  const masked = maskBrackets(text);
  // A colon introduces a list and a full stop inside it would break the items
  // away from their lead-in. The check reads the text outside the brackets, so
  // that a citation does not look like a list.
  if (masked.includes(':')) return null;
  // A semicolon outside a citation marks a list of items.
  if (masked.includes(';')) return null;
  if (LIST_MARKER_RE.test(masked)) return null;
  if (/["']/.test(text)) return null;
  if (!balanced(text)) return null;

  for (const sep of SEPARATORS) {
    const at = masked.indexOf(sep);
    if (at === -1) continue;
    const left = text.slice(0, at).trim();
    let right = text.slice(at + sep.length).trim();
    if (!left || !right) continue;
    // Both sides must stand alone as clauses.
    if (!isClause(left)) continue;
    if (!isClause(right)) continue;
    // The left half has to open on a subject. A half that opens on a number
    // or a bracket is the tail of a sentence, not a sentence.
    if (!LEFT_START.test(left) && !/^[A-Z]/.test(left)) continue;
    if (/^[\d(]/.test(left)) continue;
    // The right half has to carry a verb that is not the word right after its
    // subject. "An estimate error from a normal distribution" holds a noun
    // that is also a verb, and it is not a sentence.
    if (verbIndex && verbIndex(right) < 2) continue;
    // A side that ends on a word still waiting for its clause is broken.
    if (/\b(that|which|who|whom|whose|whether|because|if|when|while|although|though|since|unless|until|than|and|but|or|so|nor)$/i.test(left)) continue;
    // A side that opens on a word that wants a clause of its own is broken.
    if (/^(that|which|who|whom|whose|whether|because|if|when|while|although|though|since|unless|until|as|and|but|or|so|nor)\b/i.test(right)) continue;
    // The right half has to carry a subject of its own, or the sentence is
    // left without one.
    if (VERB_START.test(right)) continue;
    if (!SUBJECT_START.test(right) && !/^[A-Z]/.test(right)) continue;
    // "between the dynamics and the control laws" is not two clauses, and the
    // verb test above already rejects it. The word count keeps a cut from
    // producing a two-word fragment.
    if (wordCount(left) < 5 || wordCount(right) < 5) continue;
    right = right.charAt(0).toUpperCase() + right.slice(1);
    const end = text.slice(at + sep.length).trim();
    const cutAt = at + sep.length + (text.slice(at + sep.length).indexOf(end));
    return { left: left + '.', right: right, at: cutAt, separator: sep };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fusing
// ---------------------------------------------------------------------------

/**
 * Join two short sentences with a neutral connector.
 *
 * The connector has to be neutral. A causal connector such as "so as a result"
 * would claim a relationship that the two original sentences did not have.
 * A semicolon is the connector used for the longest joins, because it keeps
 * both clauses independent and reads cleanly where "and" would make a chain.
 */
export function fuseCandidate(first, second, opts = {}) {
  const lowerCaseOpener = opts.lowerCaseOpener || ((s) => s);
  const isBlockedOpener = opts.isBlockedOpener || (() => false);
  const connector = opts.connector || 'and';

  const a = first.trim();
  const b = second.trim();
  if (!a || !b) return null;
  if (/[?!]$/.test(a) || /[?!]$/.test(b)) return null;
  if (/[:;,]$/.test(a)) return null;
  // A colon introduces a list that belongs to the sentence it stands in, and
  // joining that sentence to the next one breaks the list away from it.
  if (maskBrackets(a).includes(':') || maskBrackets(b).includes(':')) return null;
  if (isBlockedOpener(b)) return null;
  // Two sentences that each carry their own conjunction do not join well.
  // "It takes 0.91 seconds to rise, and the overshoot is 7.4%" already has a
  // link in it, and joining it to the sentence before it produces a chain of
  // "and" that reads worse than the two sentences did. A plain "and" inside a
  // list of nouns is not a link between two clauses and does not count.
  if (/,\s+and\b/i.test(a) || /,\s+and\b/i.test(b)) return null;
  if (/^and\b/i.test(b)) return null;
  // The second sentence has to be able to open in lower case. A sentence that
  // opens with a name or a defined term cannot, and joining it would give
  // "the reference, and Overshoot is the peak above the reference".
  const lowered = lowerCaseOpener(b);
  if (lowered === b) return null;
  const maxWords = opts.maxFuseWords || 13;
  if (wordCount(a) > maxWords || wordCount(b) > maxWords) return null;
  // A join made with a semicolon has to keep both halves independent, so
  // both of them have to be clauses of their own.
  if (opts.requireClause) {
    const isClause = opts.isClause || (() => true);
    if (!isClause(a) || !isClause(b)) return null;
  }
  // A sentence that ends in an abbreviation keeps its stop.
  if (/\b[A-Za-z]\.$/.test(a)) return null;
  const sep = opts.separator || ', ' + connector + ' ';
  const merged = a.replace(/\.$/, '') + sep + lowered;
  return merged.charAt(0).toUpperCase() + merged.slice(1);
}

// ---------------------------------------------------------------------------
// Fronting a clause
// ---------------------------------------------------------------------------

// The subordinators that can open a fronted clause.
const SUBORDINATORS = [
  'when', 'while', 'after', 'before', 'since', 'if', 'unless', 'until',
  'once', 'as', 'provided that', 'given that',
];

// A subordinate clause whose subject is a pronoun may refer back to the main
// clause, so it is not moved to the front. "It" is left alone as well,
// because it is often the weather.
const PRONOUN_SUBJECT = /^(it|he|she|they|we|you|this|that|these|those|there|one)\b/i;

/**
 * Move a trailing subordinate clause to the front of its sentence.
 *
 * "The controller raises the gain when ice forms."
 * becomes
 * "When ice forms, the controller raises the gain."
 *
 * The meaning is the same and the length is the same, but the sentence no
 * longer opens the way the one before it opened. Returns the new sentence or
 * null.
 */
export function frontCandidate(sentence, opts = {}) {
  const isClause = opts.isClause || (() => true);
  const canLower = opts.canLower || ((s) => s);
  const text = sentence.trim();
  if (text.length < 50) return null;
  const masked = maskBrackets(text);
  if (masked.includes(':') || masked.includes(';')) return null;
  if (/["']/.test(text)) return null;
  if (!balanced(text)) return null;
  if (LIST_MARKER_RE.test(masked)) return null;

  // The last comma of the sentence separates the main clause from a trailing
  // subordinate clause. The main clause must not carry a comma of its own,
  // because a main clause with an internal comma is not a simple one.
  const comma = text.lastIndexOf(',');
  if (comma < 20) return null;
  const main = text.slice(0, comma).trim();
  const tail = text.slice(comma + 1).trim();
  if (main.includes(',')) return null;
  if (!tail) return null;

  const word = (tail.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
  const sub = SUBORDINATORS.find((s) => word === s || tail.toLowerCase().startsWith(s + ' '));
  if (!sub) return null;

  const rest = tail.slice(sub.length).trim();
  if (rest.length < 12) return null;
  // The subordinate clause needs a subject of its own and a verb of its own.
  if (!/^[A-Za-z]/.test(rest)) return null;
  const subjectWord = (rest.match(/^[A-Za-z]+/) || [''])[0];
  if (PRONOUN_SUBJECT.test(subjectWord)) return null;
  if (!isClause(rest)) return null;
  if (!isClause(main)) return null;

  // The two subjects must not be the same thing. "The gain rises when the gain
  // falls" is not the kind of sentence to reorder.
  const mainSubject = (main.match(/^(?:The|A|An|This|That|These|Those|Each|Every|Some|Many|Such)\s+([A-Za-z]+)/) || [])[1];
  const tailSubject = (rest.match(/^([A-Za-z]+)/) || [])[1];
  if (mainSubject && tailSubject && mainSubject.toLowerCase() === tailSubject.toLowerCase()) return null;

  const front = sub.charAt(0).toUpperCase() + sub.slice(1) + ' ' + rest;
  const back = canLower(main);
  return front + ', ' + back + '.';
}

// ---------------------------------------------------------------------------
// The cadence repair
// ---------------------------------------------------------------------------

export const RHYTHM_DEFAULTS = {
  flatCv: 0.45,
  targetCv: 0.55,
  minSentences: 3,
  longFactor: 1.12,
  shortFactor: 0.8,
  maxFuseWords: 13,
  maxJoinWords: 34,
  maxSemicolonJoins: 1,
  maxRepairs: 4,
};

/**
 * Raise the burstiness of a paragraph by repairing its flattest sentences.
 *
 * The paragraph is measured first. If it already varies enough, nothing is
 * done. If it does not, every repair that is safe is tried, the paragraph is
 * measured again for each one, and only the repair that lifts the variation
 * most is kept. A repair that lowers the variation is thrown away, because a
 * repair that makes the rhythm flatter has defeated itself.
 *
 * Two repairs are available. A long sentence can be cut in two where both
 * halves are clauses of their own, which adds a short sentence. Two
 * neighbours can be joined, which makes one long sentence out of two short
 * ones. Both change the rhythm without changing a fact.
 */
export function repairCadence(sentences, opts = {}) {
  const cfg = Object.assign({}, RHYTHM_DEFAULTS, opts.config || {});
  const actions = [];
  let list = sentences.slice();
  let semicolonJoins = 0;

  const measure = (arr) => cadenceStats(arr.map(wordCount));

  for (let pass = 0; pass < cfg.maxRepairs; pass++) {
    if (list.length < cfg.minSentences) break;
    const before = measure(list);
    if (before.cv >= cfg.targetCv) break;

    // Every repair that is safe is collected, and the best one is kept.
    const candidates = [];

    for (let i = 0; i < list.length; i++) {
      const cand = splitCandidate(list[i], opts);
      if (cand) {
        const trial = list.slice();
        trial.splice(i, 1, cand.left, cand.right);
        candidates.push({ type: 'split', index: i, list: trial, cv: measure(trial).cv });
      }
    }

    for (let i = 0; i < list.length - 1; i++) {
      // The short join first, then the long one. The long join uses a
      // semicolon, which keeps both clauses independent and reads cleanly
      // where a second "and" would make a chain.
      const variants = [
        { separator: ', and ', maxFuseWords: cfg.maxFuseWords, requireClause: false },
        { separator: '; ', maxFuseWords: cfg.maxJoinWords, requireClause: true },
      ];
      for (const v of variants) {
        // One long join per paragraph. A paragraph of semicolons reads as a
        // list, not as an argument, and it is not what a writer would do.
        if (v.separator === '; ' && semicolonJoins >= cfg.maxSemicolonJoins) continue;
        const merged = fuseCandidate(list[i], list[i + 1], Object.assign({}, opts, v));
        if (!merged) continue;
        const trial = list.slice();
        trial.splice(i, 2, merged);
        candidates.push({ type: 'fuse', index: i, list: trial, cv: measure(trial).cv });
        break;
      }
    }

    if (!candidates.length) break;
    // The repair that lifts the variation most wins. A repair that makes the
    // paragraph flatter is not a repair.
    candidates.sort((a, b) => b.cv - a.cv);
    const best = candidates[0];
    if (best.cv <= before.cv) break;
    list = best.list;
    actions.push({ type: best.type, index: best.index });
    // The joins that use a semicolon are counted in the text itself, because
    // a later repair can move a sentence and change the index.
    semicolonJoins = list.join(' ').split('; ').length - 1;
  }

  return { sentences: list, actions, cv: measure(list).cv };
}

/**
 * Find the sentences in a paragraph that open with the same words and give
 * the later ones a different opening where that can be done safely.
 */
export function varyOpeners(sentences, opts = {}) {
  const list = sentences.slice();
  const seen = new Map();
  const actions = [];
  for (let i = 0; i < list.length; i++) {
    const key = openerKey(list[i], 2);
    if (!key) continue;
    const count = seen.get(key) || 0;
    if (count === 0) {
      seen.set(key, 1);
      continue;
    }
    // The second sentence of a pair that opens the same way gets a fronted
    // clause if it can take one.
    const candidate = frontCandidate(list[i], opts);
    if (candidate) {
      const newKey = openerKey(candidate, 2);
      if (newKey !== key) {
        list[i] = candidate;
        actions.push({ type: 'front', index: i, key, newKey });
        seen.set(newKey, (seen.get(newKey) || 0) + 1);
        continue;
      }
    }
    seen.set(key, count + 1);
  }
  return { sentences: list, actions };
}
