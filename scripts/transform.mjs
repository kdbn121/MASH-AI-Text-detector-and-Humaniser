#!/usr/bin/env node
// transform.mjs — deterministic multi-stage rewriting engine.
//
//   node scripts/transform.mjs <file> --out <file> [--source <file>]
//        [--intensity light|standard|heavy|max] [--plan <plan.json>] [--dry-run]
//
// Sixteen ordered stages, each with its own fire rate and its own gate:
//   1  phrase rewrites         9  discourse marker rotation
//   2  stock word swaps       10  hedge insertion
//   3  synonym substitution   11  de-nominalisation
//   4  determiner cycling     12  appositive insertion
//   5  clause reordering      13  cadence repair
//   6  voice transformation   14  opener variation
//   7  split and fusion       15  document rhythm
//   8  transition injection   16  final chain breaking
//
// Protected content is masked before stage 1 and restored after stage 16.
// For a .docx input the engine emits a plan file for rewrite-docx.mjs, which
// applies the changes with its own structural safety checks.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflectMatch, detectForm } from './lib-inflect.mjs';
import { readZip } from './lib-zip.mjs';
import { extractText, tokenize, TRIGGER_PHRASES } from './lib-text.mjs';
import { classifySequence, looksLikeFilename } from './lib-guard.mjs';
import { frontCandidate, openerKey, repairCadence, varyOpeners, wordCount } from './lib-rhythm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RULES = join(HERE, '..', 'rules');

// Every rule bank carries a "_copyright" key so the KDBN mark travels with the
// data. A bank whose data is a list stores it under "items".
function load(dir, name) {
  const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  if (raw && !Array.isArray(raw) && Array.isArray(raw.items)) return raw.items;
  return raw;
}

/**
 * Load a bank that a discipline folder is allowed to leave out.
 *
 * The cadence thresholds have sensible defaults, so a discipline rule set
 * that does not carry its own copy still works. Every other bank is required,
 * because a missing bank would silently change the meaning of the rewrite.
 */
function loadOptional(dir, name, fallback) {
  const file = join(dir, name);
  if (!existsSync(file)) return fallback;
  return load(dir, name);
}

function loadRuleSet(dir) {
  return {
    phrases: load(dir, 'phrases.json'),
    synonyms: load(dir, 'synonyms.json'),
    determiners: load(dir, 'determiners.json'),
    transitions: load(dir, 'transitions.json'),
    discourse: load(dir, 'discourse.json'),
    hedges: load(dir, 'hedges.json'),
    protected: load(dir, 'protected_terms.json'),
    nominalisations: load(dir, 'nominalisations.json'),
    appositives: load(dir, 'appositives.json'),
    rhythm: loadOptional(dir, 'rhythm.json', {}),
    tells: loadOptional(dir, 'tells.json', {}),
  };
}

/** The real entries of a rule bank, without the metadata keys. */
function entries(bank) {
  if (Array.isArray(bank)) return bank;
  return Object.keys(bank)
    .filter((k) => !k.startsWith('_'))
    .map((k) => [k, bank[k]]);
}

// The rule set is loaded once here, and reloaded if the caller points the
// engine at a different bank directory with --rules.
let RULESET = loadRuleSet(RULES);

// ---------------------------------------------------------------------------
// Intensity: non-linear, so the top end bites harder than the midpoint.
// ---------------------------------------------------------------------------

const INTENSITY = {
  light: 40,
  standard: 70,
  heavy: 90,
  max: 100,
};

function curve(level) {
  return Math.pow(level / 100, 0.75);
}

const FIRE = {
  phrase: 1.0,
  synonym: 0.7,
  determiner: 0.4,
  clause: 0.2,
  voice: 0.3,
  split: 0.25,
  transition: 0.25,
  discourse: 0.5,
  hedge: 0.2,
  nominal: 0.2,
  appositive: 0.35,
  cadence: 1.0,
  opener: 0.7,
};

// ---------------------------------------------------------------------------
// Deterministic RNG so the same input always gives the same output.
// ---------------------------------------------------------------------------

function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Masking. Letters only, so no numeric mask can ever match inside a mask.
// ---------------------------------------------------------------------------

function maskToken(i) {
  // Bijective base-26: A = 1 ... Z = 26, so the decoder below reads back the
  // exact index that was encoded here.
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return '\u0000M' + out + '\u0000';
}

const MASK_RE = /\u0000M([A-Z]+)\u0000/g;

function protect(text) {
  const tokens = [];
  let out = text;

  const place = (re) => {
    out = out.replace(re, (m) => {
      tokens.push(m);
      return maskToken(tokens.length - 1);
    });
  };

  place(/\$[^$]{0,400}\$/g);
  place(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})*/g);
  place(/https?:\/\/\S+/g);
  place(/\b[\w.+-]+@[\w.-]+\.\w+\b/g);
  place(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi);
  place(/"[^"]{2,400}"/g);
  place(/\('[^']{2,400}'\)/g);
  // A quoted file name such as 'Main_Script_All_Figures.m'. The extension is
  // required, so an apostrophe inside an ordinary word cannot match, and the
  // name the reader has to type survives the rewrite intact.
  place(/'[^'<>|\n]{1,120}\.[A-Za-z0-9]{1,8}'/g);
  // A parenthetical citation. The pattern is deliberately broad, because a
  // citation that is not masked is a citation that can be broken: "(Shaghoury
  // et al., 2021)", "(Bertran et al., 2022; Gryte et al., 2020)" and
  // "(Ziegler & Nichols, 1942)" all have to survive exactly as written.
  place(/\((?:[A-Z][A-Za-z'.-]+[^();]{0,60}?\b\d{4}[a-z]?(?:,\s*(?:p{1,2}\.?\s*)?\d+)?)(?:\s*;\s*[A-Z][A-Za-z'.-]+[^();]{0,60}?\b\d{4}[a-z]?(?:,\s*(?:p{1,2}\.?\s*)?\d+)?)*\)/g);
  // The author part of a narrative citation: "Gryte et al.". Masking it keeps
  // the sentence splitter away from the abbreviation and keeps the surname's
  // capitalisation, so "Gryte et al. (2022)" survives intact.
  place(/\b[A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)*\s+et\s+al\./g);
  place(/\b\d+(?:[.,]\d+)*\s*(?:%|per cent|percent|years?|months?|days?|hours?|minutes?|seconds?|kg|km|cm|mm|nm|Hz|kHz|MHz|GB|MB|KB|degC|C|mol|mg|microg|ng|pg)\b/gi);
  place(/\b\d+(?:[.,]\d+)+\b/g);
  place(/\b\d+\b/g);

  // The longest term is masked first, so that a short term cannot swallow
  // part of a longer one. Without this, "flight control" is masked before
  // "flight control system" and the word "system" is left unprotected.
  const protectedOrder = [...RULESET.protected].sort((a, b) => String(b).length - String(a).length);
  for (const term of protectedOrder) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A trailing "s" is allowed, so that a protected term covers its plural
    // as well. Without this, "control system" is protected but "control
    // systems" is not, and the engine changes one and not the other.
    const plural = /s$/i.test(term) ? '' : 's?';
    place(new RegExp('(?<![A-Za-z0-9])' + esc + plural + '(?![A-Za-z0-9])', 'g'));
  }

  return { masked: out, tokens };
}

function restore(text, tokens) {
  return text.replace(MASK_RE, (m, code) => {
    let n = 0;
    for (const ch of code) n = n * 26 + (ch.charCodeAt(0) - 64);
    return tokens[n - 1] !== undefined ? tokens[n - 1] : m;
  });
}

// ---------------------------------------------------------------------------
// Sentence handling
// ---------------------------------------------------------------------------

// Abbreviations that end in a full stop but do not end a sentence. Without
// this list a citation such as "Gryte et al. (2022)" is cut in two.
const ABBREVIATIONS = [
  'et al', 'e.g', 'i.e', 'cf', 'vs', 'fig', 'figs', 'eq', 'eqs', 'approx',
  'dr', 'prof', 'mr', 'mrs', 'st', 'vol', 'pp', 'etc', 'resp', 'tab', 'secs',
];

function endsWithAbbreviation(before) {
  return ABBREVIATIONS.some((a) =>
    new RegExp('(^|[^A-Za-z0-9])' + a.replace(/\./g, '\\.') + '\\.$', 'i').test(before)
  );
}

function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?]\s+(?=["'(A-Z])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 14), m.index + 1);
    if (endsWithAbbreviation(before)) continue;
    out.push(text.slice(start, m.index + 1).trim());
    start = m.index + m[0].length;
  }
  out.push(text.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

// Words that must not follow a fronted preposition, or the reorder breaks a
// sentence like "For example, the results...".
const NOT_A_PHRASE = new Set([
  'example', 'instance', 'comparison', 'contrast', 'addition', 'conclusion',
  'fact', 'practice', 'principle', 'particular', 'general', 'order', 'terms',
  'spite', 'purpose', 'this', 'the', 'a', 'an', 'that', 'which', 'those',
  'these', 'most', 'all', 'some', 'such', 'one', 'two', 'both', 'each',
]);

const FRONTED = /^(In|Within|During|Through|Using|By|With|For|Under|Despite|According to)\s+([^,]{3,60}),\s+(.+)$/;

const VOICE_VERBS = {
  analysed: 'analyse', examined: 'examine', studied: 'study', applied: 'apply',
  demonstrated: 'demonstrate', conducted: 'conduct', performed: 'perform',
  obtained: 'obtain', collected: 'collect', identified: 'identify',
  developed: 'develop', evaluated: 'evaluate', measured: 'measure',
  observed: 'observe', calculated: 'calculate', estimated: 'estimate',
  selected: 'select', determined: 'determine', reported: 'report',
  recorded: 'record', undertaken: 'undertake', presented: 'present',
  explored: 'explore', compared: 'compare', assessed: 'assess',
  investigated: 'investigate', described: 'describe', explained: 'explain',
  shown: 'show', indicated: 'indicate', supported: 'support',
  confirmed: 'confirm', verified: 'verify', validated: 'validate',
  used: 'use', modelled: 'model', implemented: 'implement',
};

// Rotation of discourse markers. The substitutes live in rules/discourse.json
// so a user can extend them. Only substitutes that can stand in the same slot
// as the original are listed. A sentence-level connective such as "it follows
// that" cannot replace an in-sentence adverb such as "therefore" without
// producing broken syntax.

// The connectors used to fuse two short sentences. They have to be neutral:
// a causal connector such as "and as a result" claims a relationship that the
// original sentences did not have.
const FUSION_CONNECTORS = ['and', 'and so'];

// An agent that is a pronoun takes its object form after "by", so that
// "They used the method" becomes "The method was used by them".
const PRONOUN_OBJECT = {
  they: 'them',
  we: 'us',
  i: 'me',
  he: 'him',
  she: 'her',
  it: 'it',
};

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

function createContext(opts) {
  const level = INTENSITY[opts.intensity] ?? INTENSITY.standard;
  const k = curve(level);
  return {
    rng: makeRng(opts.seed ?? 20261026),
    k,
    level,
    // The safe mode keeps only the stages that cannot change the meaning of a
    // sentence: the stock word swaps, the cadence repair, the opener change
    // and the chain breaking. It is the mode to use on a manuscript that a
    // person has to sign their name to.
    safe: opts.safe === true,
    usedSynonyms: new Set(),
    usedTransitions: new Set(),
    usedMarkers: new Set(),
    usedAppositives: new Set(),
    counts: {},
    fired(stage, n) {
      this.counts[stage] = (this.counts[stage] || 0) + (n === undefined ? 1 : n);
    },
    gate(stage) {
      const rate = (FIRE[stage] ?? 0) * k;
      return this.rng() < rate;
    },
  };
}

// ---------------------------------------------------------------------------
// Part-of-speech guessing.
//
// Some lemmas are both noun and verb, for example "support" and "change". A
// single flat synonym list cannot serve both, because "support" as a noun
// needs "backing" while "support" as a verb needs "corroborate". The rules
// below read the immediate context to decide which pool is safe to use.
// ---------------------------------------------------------------------------

const NOUN_CUE_BEFORE =
  /\b(the|a|an|this|that|these|those|its|their|our|his|her|your|my|each|every|no|any|some|such|following|above|below|former|latter|main|key|major|minor|significant|strong|overall|public|private|local|national|global|same|only|very|much|many|several|few|most)\s*$/i;
const VERB_CUE_BEFORE =
  /\b(to|will|can|could|may|might|must|should|would|shall|did|do|does|not|never|also|then|thus|however|therefore|moreover|cannot|can't|don't|doesn't|isn't|aren't)\s*$/i;
const NOUN_CUE_AFTER =
  /^\s+(of|for|in|on|at|to|with|from|across|within|during|between|among|regarding|towards?|through|under|over|into|about|against|besides|beyond)\b/i;
const VERB_CUE_AFTER =
  /^\s+(the|a|an|this|these|those|its|their|our|his|her|when|whether|that|him|them|us|how|why|what|because|if|as)\b/i;

function guessPos(text, offset) {
  const before = text.slice(Math.max(0, offset - 40), offset);
  const after = text.slice(offset);
  if (VERB_CUE_BEFORE.test(before)) return 'verb';
  if (VERB_CUE_AFTER.test(after)) return 'verb';
  if (NOUN_CUE_BEFORE.test(before)) return 'noun';
  if (NOUN_CUE_AFTER.test(after)) return 'noun';
  return 'unknown';
}

/**
 * Pick the replacement pool for a lemma, honouring the grammatical form of the
 * word that is being replaced. An adverb such as "poorly" is detected as the
 * adverb form of "poor", so the bank can carry a separate adverb pool rather
 * than deriving one from the adjective.
 */
function poolFor(lemma, word, pos) {
  const entry = RULESET.synonyms[lemma];
  if (!entry) return null;
  const form = detectForm(word).form;
  if (!Array.isArray(entry) && form === 'adverb' && entry.adverb && entry.adverb.length) {
    return entry.adverb;
  }
  return synonymPool(lemma, word, pos);
}

/**
 * Pick the replacement pool for a lemma.
 * The rule value is either a flat array or an object of part-of-speech pools.
 */
function synonymPool(lemma, word, pos) {
  const entry = RULESET.synonyms[lemma];
  if (!entry) return null;
  if (Array.isArray(entry)) return entry;
  if (pos && entry[pos] && entry[pos].length) return entry[pos];
  const anyPool = ['noun', 'verb', 'adj', 'adverb']
    .map((k) => entry[k])
    .filter((v) => Array.isArray(v) && v.length);
  return anyPool.length ? anyPool.flat() : null;
}

// Fixed relative constructions such as "the extent to which" cannot survive a
// synonym swap, because the swapped noun no longer forms the collocation.
const RELATIVE_CUE_AFTER = /^\s+(?:to|of|in|for|on|at|by)\s+(?:which|whom|where)\b/i;

/**
 * True when a sentence holds one of the stock machine phrases.
 *
 * The rewrite must never create one. A bank entry that would turn "major" into
 * "significant" in front of "role" would write "a significant role", which is
 * exactly the phrase the phrase audit looks for. The check is a plain forward
 * containment, which is how the audit counts them too.
 */
function containsTrigger(text) {
  const lower = text.toLowerCase();
  for (const phrase of TRIGGER_PHRASES) {
    if (lower.includes(phrase)) return true;
  }
  return false;
}

// The particle of a phrasal verb. A swap that leaves the particle behind
// produces "adopt into account" and "employ out of".
const PHRASAL_PARTICLE =
  /^\s+(?:into|onto|on|off|out|up|down|over|under|away|back|about|along|around|through|apart|aside)\b/i;

// Articles have to follow the vowel of the word that follows them, so a swap
// that changes "an incremental" into "a progressive" has to be corrected.
const ARTICLE_EXCEPTIONS = [
  'university', 'universal', 'unique', 'user', 'union', 'unit', 'european',
  'useful', 'usual', 'one', 'once', 'ubiquitous', 'unicorn',
];

function fixArticles(text) {
  let out = text.replace(/\b(a)(\s+)([A-Za-z]\w+)/g, (m, art, sp, w) => {
    const lw = w.toLowerCase();
    if (!/^[aeiou]/.test(lw)) return m;
    if (ARTICLE_EXCEPTIONS.some((e) => lw.startsWith(e))) return m;
    return 'an' + sp + w;
  });
  out = out.replace(/\b(an)(\s+)([A-Za-z]\w+)/g, (m, art, sp, w) => {
    const lw = w.toLowerCase();
    if (/^[aeiou]/.test(lw)) return m;
    if (/^(hour|honest|honour|honor)/.test(lw)) return m;
    return 'a' + sp + w;
  });
  return out;
}

function stagePhrases(sentence, ctx) {
  let out = sentence;
  for (const [phrase, replacement] of RULESET.phrases) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'gi');
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, (m, offset) => {
      if (replacement === '') return '';
      // The rule author supplies the replacement in its correct grammatical
      // form, so no inflection is applied here. Inflecting an already inflected
      // replacement is what produces nonsense such as "indicatesed".
      let rep = replacement;
      if (m[0] === m[0].toUpperCase() && rep[0] === rep[0].toLowerCase()) {
        rep = rep.charAt(0).toUpperCase() + rep.slice(1);
      }
      // A rewrite must not create a stock machine phrase that was not there.
      const candidate = out.slice(0, offset) + rep + out.slice(offset + m[0].length);
      if (!containsTrigger(out) && containsTrigger(candidate)) return m;
      ctx.fired('phrase');
      return rep;
    });
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

function stageSynonyms(sentence, ctx) {
  return sentence.replace(/[A-Za-z][A-Za-z'-]*/g, (word, offset, whole) => {
    const lower = word.toLowerCase();
    const entry = RULESET.synonyms[lower];
    if (!entry) return word;
    if (!ctx.gate('synonym')) return word;
    if (RELATIVE_CUE_AFTER.test(whole.slice(offset + word.length))) return word;

    const { lemma, form } = detectForm(lower);
    const pos = guessPos(whole, offset);
    // A word that is part of a phrasal verb keeps its place. "take into
    // account" cannot become "adopt into account", and "focus on" cannot
    // become "concentrate upon" with the particle left behind.
    const afterWord = whole.slice(offset + word.length);
    if (PHRASAL_PARTICLE.test(afterWord)) return word;
    // A bank that separates its pools by part of speech cannot be used when
    // the part of speech cannot be read from the context, because the engine
    // would then be choosing at random between a noun and a verb. "that
    // signal needs to be" would become "that suggest needs to be".
    if (!Array.isArray(entry) && pos === 'unknown' && form !== 'adverb') return word;
    const pool = poolFor(lemma, lower, pos);
    if (!pool) return word;

    // A multi-word replacement cannot be inflected, so it is only used for a
    // bare singular noun that carries its own determiner.
    const explicitPos = !Array.isArray(entry);
    const usable = pool.filter((s) => {
      if (/\s/.test(s)) return explicitPos && pos === 'noun' && form === 'base';
      return true;
    });
    if (!usable.length) return word;
    const fresh = usable.filter((s) => !ctx.usedSynonyms.has(lemma + '>' + s));
    const pick = (fresh.length ? fresh : usable)[Math.floor(ctx.rng() * (fresh.length ? fresh.length : usable.length))];

    // An adverb cannot stand in for an adjective, a noun or a verb. Without
    // this check the engine writes "Recently advances have led" and "has become
    // really soundly", because the bank offers an adverb for an adjective.
    const originalForm = detectForm(lower).form;
    if (originalForm !== 'adverb' && detectForm(pick).form === 'adverb') return word;

    const replacement = inflectMatch(pick, word);
    if (replacement.toLowerCase() === lower) return word;
    // A swap must not write a stock machine phrase that was not there before.
    const candidate = whole.slice(0, offset) + replacement + whole.slice(offset + word.length);
    if (!containsTrigger(whole) && containsTrigger(candidate)) return word;
    ctx.usedSynonyms.add(lemma + '>' + pick);
    ctx.fired('synonym');
    return replacement;
  });
}

function stageDeterminers(sentence, ctx) {
  return sentence.replace(/\b(a|an|the|several|many|some|few|most|all|each|both|another|such|other|any|every)\b/gi, (m, _all, offset, whole) => {
    const lower = m.toLowerCase();
    const options = RULESET.determiners[lower];
    if (!options) return m;
    if (!ctx.gate('determiner')) return m;
    // A quantifier that governs a following "of" phrase cannot be swapped for a
    // phrase-style replacement, because the complement would be left dangling.
    const after = whole.slice(offset + m.length);
    if (/^\s+of\b/i.test(after)) return m;
    // "how many" is a question, not a quantifier, and "how numerous" is not
    // English. The word in front of the quantifier settles it.
    const before = whole.slice(Math.max(0, offset - 8), offset);
    if (/\bhow\s*$/i.test(before)) return m;
    // A quantifier used on its own is a pronoun. "many are" cannot become
    // "numerous are".
    if (/^\s+(?:are|is|were|was|have|has|do|does|did|remain|seem|appear|can|could|will|would|may|might|must)\b/i.test(after)) return m;
    const usable = options.filter((o) => !/\s/.test(o));
    if (!usable.length) return m;
    const pick = usable[Math.floor(ctx.rng() * usable.length)];
    ctx.fired('determiner');
    return /^[A-Z]/.test(m) ? pick.charAt(0).toUpperCase() + pick.slice(1) : pick;
  });
}

function stageClause(sentence, ctx) {
  if (sentence.length < 80) return sentence;
  if (!ctx.gate('clause')) return sentence;
  const m = sentence.match(FRONTED);
  if (!m) return sentence;
  const [full, prep, noun, rest] = m;
  const head = noun.split(/\s+/)[0].toLowerCase();
  if (NOT_A_PHRASE.has(head)) return sentence;
  if (/^[A-Z]/.test(noun)) return sentence;
  // A fronted phrase belongs to the clause it opens. When the rest of the
  // sentence holds a contrast, the phrase qualifies only the first clause and
  // must stay at the front.
  if (/,\s+(?:but|and|yet|so|while|although|whereas)\b/i.test(rest)) return sentence;
  // A sentence that ends with a reference would leave the moved phrase after
  // the reference, which reads as though the reference belonged to it.
  if (/\([^()]*\)\s*$/.test(rest)) return sentence;
  const lowerPrep = prep.toLowerCase() === 'according to' ? 'according to' : prep.toLowerCase();
  const moved = rest.replace(/\.$/, '') + ' ' + lowerPrep + ' ' + noun + '.';
  ctx.fired('clause');
  return moved.charAt(0).toUpperCase() + moved.slice(1);
}

function pluralish(word) {
  return /s$/i.test(word) && !/ss$/i.test(word);
}

function stageVoice(sentence, ctx) {
  if (sentence.length < 60) return sentence;
  if (!ctx.gate('voice')) return sentence;

  // passive -> active: "The results were analysed by researchers."
  const p2a = sentence.match(/^(The|A|An)\s+(.+?)\s+(was|were|is|are)\s+(\w+ed|\w+n)\s+by\s+(.+?)\.?$/i);
  if (p2a && VOICE_VERBS[p2a[4].toLowerCase()]) {
    const verb = VOICE_VERBS[p2a[4].toLowerCase()];
    const out = p2a[5].charAt(0).toUpperCase() + p2a[5].slice(1) + ' ' + verb + ' ' +
      p2a[1].toLowerCase() + ' ' + p2a[2] + '.';
    ctx.fired('voice');
    return out;
  }

  // "This study examines the impact." -> "The impact is examined in this study."
  const study = sentence.match(/^This\s+(study|paper|work|article|report)\s+(\w+)\s+(the|a|an)\s+(.+?)\.?$/i);
  if (study) {
    const verb = study[2].toLowerCase();
    const participle = verb.endsWith('e') ? verb + 'd' : verb + 'ed';
    const aux = pluralish(study[4]) ? 'are' : 'is';
    const out = study[3].charAt(0).toUpperCase() + study[3].slice(1) + ' ' + study[4] + ' ' + aux +
      ' ' + participle + ' in this ' + study[1].toLowerCase() + '.';
    ctx.fired('voice');
    return out;
  }

  // active -> passive, keeping the agent: "Researchers applied the method."
  const a2p = sentence.match(/^([A-Z][A-Za-z]+)\s+(\w+ed|\w+n)\s+(the|a|an)\s+(.+?)\.?$/);
  if (a2p && VOICE_VERBS[a2p[2].toLowerCase()]) {
    const participle = a2p[2].toLowerCase();
    const aux = pluralish(a2p[4]) ? 'were' : 'was';
    // An agent that is a pronoun has to take its object form after "by",
    // otherwise the sentence reads "was used by they".
    const agent = PRONOUN_OBJECT[a2p[1].toLowerCase()] || a2p[1].toLowerCase();
    const out = a2p[3].charAt(0).toUpperCase() + a2p[3].slice(1) + ' ' + a2p[4] + ' ' + aux +
      ' ' + participle + ' by ' + agent + '.';
    ctx.fired('voice');
    return out;
  }

  return sentence;
}

// A clause is only a clause if it carries its own finite verb. Splitting a
// sentence in the middle of a coordinated noun phrase leaves a fragment, for
// example "The extent to which digital systems improve public service
// outcomes", which reads as broken prose.
const FINITE_VERB = /\b(is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|may|might|must|shall|should|will|would|show|shows|showed|indicate|indicates|indicated|demonstrate|demonstrates|demonstrated|suggest|suggests|suggested|support|supports|supported|provide|provides|provided|require|requires|required|improve|improves|improved|affect|affects|affected|reduce|reduces|reduced|increase|increases|increased|lead|leads|led|result|results|resulted|emerge|emerges|emerged|enable|enables|enabled|find|finds|found|report|reports|reported|examine|examines|examined|develop|develops|developed|identify|identifies|identified|measure|measures|measured|remain|remains|became|become|becomes|include|includes|included|contain|contains|contained|create|creates|created|produce|produces|produced|explain|explains|explained|describe|describes|described|reveal|reveals|revealed|apply|applies|applied|use|uses|used|need|needs|needed|play|plays|played|make|makes|made|take|takes|took|give|gives|gave|consider|considers|considered|treat|treats|treated|determine|determines|determined|note|notes|noted|argue|argues|argued|observe|observes|observed|record|records|recorded|compare|compares|compared|explore|explores|explored|trace|traces|traced|shape|shapes|shaped|influence|influences|influenced|undermine|undermines|undermined|strengthen|strengthens|strengthened|weaken|weakens|weakened|rise|rises|rose|fall|falls|fell|grow|grows|grew|change|changes|changed|cause|causes|caused|occur|occurs|occurred|appear|appears|appeared|seem|seems|seemed|hold|holds|held|keep|keeps|kept|carry|carries|carried|drive|drives|drove|control|controls|controlled|model|models|modelled|simulate|simulates|simulated|validate|validates|validated|verify|verifies|verified|confirm|confirms|confirmed|check|checks|checked|test|tests|tested|compute|computes|computed|estimate|estimates|estimated|predict|predicts|predicted|preserve|preserves|preserved|maintain|maintains|maintained|satisfy|satisfies|satisfied|exceed|exceeds|exceeded|reach|reaches|reached|settle|settles|settled|respond|responds|responded|vary|varies|varied|depend|depends|depended|involve|involves|involved|determine|determines|determined|stem|stems|stemmed|originate|originates|originated|reflect|reflects|reflected|capture|captures|captured|represent|represents|represented|present|presents|presented|ensure|ensures|ensured|guarantee|guarantees|guaranteed|impose|imposes|imposed|restrict|restricts|restricted|limit|limits|limited|expand|expands|expanded|contract|contracts|contracted|accelerate|accelerates|accelerated|delay|delays|delayed|suppress|suppresses|suppressed|amplify|amplifies|amplified|attenuate|attenuates|attenuated|stabilise|stabilises|stabilised|stabilize|stabilizes|stabilized|destabilise|destabilises|destabilised|destabilize|destabilizes|stabilized|oscillate|oscillates|oscillated|converge|converges|converged|diverge|diverges|diverged|recover|recovers|recovered|extend|extends|extended|restrict|restricts|restricted|scale|scales|scaled|degrade|degrades|degraded|compensate|compensates|compensated|estimate|estimates|estimated|approximate|approximates|approximated|measure|measures|measured|define|defines|defined|specify|specifies|specified|derive|derives|derived|obtain|obtains|obtained|assume|assumes|assumed|expect|expects|expected|imply|implies|implied|reveal|reveals|revealed|suggest|suggests|suggested|confirm|confirms|confirmed|demonstrate|demonstrates|demonstrated|highlight|highlights|highlighted|emphasise|emphasises|emphasised|emphasize|emphasizes|emphasized|address|addresses|addressed|treat|treats|treated|handle|handles|handled|cope|copes|coped|face|faces|faced|expose|exposes|exposed|offer|offers|offered|present|presents|presented|argue|argues|argued|claim|claims|claimed|suggest|suggests|suggested|conclude|concludes|concluded|estimate|estimates|estimated|assume|assumes|assumed|consider|considers|considered|evaluate|evaluates|evaluated|validate|validates|validated)\b/i;

const NOMINALISER_HEAD = /^(?:the|a|an)\s+\w+\s+to\s+(?:which|whom)\b/i;

function isClause(text) {
  const t = text.replace(MASK_RE, ' ').trim();
  if (t.length < 25) return false;
  if (NOMINALISER_HEAD.test(t)) return false;
  // The verb has to be a finite verb of this clause. A participle inside a
  // relative clause does not make the phrase a clause: "the open framework
  // that produced it" is a noun phrase, and splitting a sentence there
  // leaves a fragment behind.
  const re = new RegExp(FINITE_VERB.source, 'gi');
  let m;
  while ((m = re.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - 16), m.index);
    if (/\b(?:that|which|who|whom|whose)\s+\w+$/i.test(before)) continue;
    if (/\b(?:that|which|who|whom|whose)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * The position of the first finite verb of a clause, in words.
 *
 * A word index is used rather than a yes or no, because a noun can be a verb
 * as well: "an estimate error from a normal distribution" holds the word
 * "estimate", and a reader would not call that a sentence. A verb that sits
 * right behind the subject is the sign of a noun phrase, not of a clause.
 * Returns -1 when no verb is found.
 */
function verbIndex(text) {
  const t = text.replace(MASK_RE, ' ').trim();
  const re = new RegExp(FINITE_VERB.source, 'gi');
  let m;
  while ((m = re.exec(t)) !== null) {
    const before = t.slice(Math.max(0, m.index - 16), m.index);
    if (/\b(?:that|which|who|whom|whose)\s+\w+$/i.test(before)) continue;
    if (/\b(?:that|which|who|whom|whose)\s*$/i.test(before)) continue;
    // The word index is the number of words before the match.
    return t.slice(0, m.index).trim().split(/\s+/).filter(Boolean).length;
  }
  return -1;
}

// An enumerated list inside a sentence. Splitting between the items breaks
// the list, because "(3) ...; (4) ..." becomes "(3) .... (4) ...".
const LIST_MARKER_RE = /\(\d{1,2}\)|\b\d{1,2}\.\s+[A-Z]/;

// A half of a split sentence must not start with a word that wants a main
// clause of its own, and must not end with a word that is still waiting for
// one. Splitting "...show that the model solves the equations correctly, and
// that the energy values are insensitive to the time step" at the comma would
// otherwise leave "That the energy values are insensitive to the time step."
// as a fragment.
const DANGLING_START =
  /^(that|which|who|whom|whose|whether|because|if|when|while|although|though|since|unless|until|as|and|but|or|so|nor)\b/i;
const DANGLING_END =
  /\b(that|which|who|whom|whose|whether|because|if|when|while|although|though|since|unless|until|than|and|but|or|so|nor)$/i;

function stageSplit(sentence, ctx) {
  if (sentence.length < 120) return sentence;
  if (!ctx.gate('split')) return sentence;
  // A sentence that carries an enumerated list is left whole.
  if (LIST_MARKER_RE.test(sentence)) return sentence;
  // A colon introduces a list or an explanation that a full stop would break
  // away from its lead-in: "the main change is that the aircraft becomes
  // slower: rise time of 1.07 s; overshoot of 5.4%; error of 19.9%".
  if (/:\s/.test(sentence)) return sentence;
  const parts = sentence.split(/(, and |, but |; )/);
  if (parts.length < 2) return sentence;
  const cut = Math.floor(parts.length / 2);
  const left = parts.slice(0, cut).join('').trim();
  const right = parts.slice(cut).join('').replace(/^(, and |, but |; )/, '').trim();
  if (left.length < 25 || right.length < 25) return sentence;
  // Both halves must stand alone as clauses.
  if (!isClause(left) || !isClause(right)) return sentence;
  // Neither half may be left hanging on a word that still wants its clause.
  if (DANGLING_START.test(right) || DANGLING_END.test(left)) return sentence;
  ctx.fired('split');
  return left + '. ' + right.charAt(0).toUpperCase() + right.slice(1);
}

// Words that may be lowercased when a sentence is fused onto the one before
// it. Anything not on this list keeps its capitalisation, because lowercasing
// a surname such as "Gryte" turns a name into a common noun.
const SAFE_OPENER = new Set([  'this', 'that', 'these', 'those', 'it', 'they', 'he', 'she', 'we', 'you',
  'the', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'as',
  'when', 'while', 'after', 'before', 'since', 'if', 'then', 'there', 'here',
  'its', 'their', 'our', 'his', 'her', 'your', 'my', 'such', 'both', 'each',
  'some', 'many', 'most', 'other', 'others', 'several', 'all', 'no', 'not',
  'and', 'or', 'but', 'so', 'yet', 'also', 'however', 'therefore', 'thus',
  'hence', 'indeed', 'moreover', 'furthermore', 'additionally', 'consequently',
  'nevertheless', 'overall', 'next',
  'finally', 'lastly', 'initially', 'originally', 'either', 'neither', 'because',
  'although', 'while', 'whereas', 'if', 'unless', 'once', 'until', 'after',
]);

function lowerCaseOpener(sentence) {
  const m = sentence.match(/^[A-Za-z]+/);
  if (!m) return sentence;
  const word = m[0];
  if (!SAFE_OPENER.has(word.toLowerCase())) return sentence;
  return word.charAt(0).toLowerCase() + word.slice(1) + sentence.slice(word.length);
}

// A sentence that opens with an enumerator or a discourse marker cannot be
// fused onto the one before it, because the connector would land in front of
// "First" or "Moreover" and the sentence would stop making sense.
const SENTENCE_OPENER = /^(?:first|second|third|fourth|fifth|finally|lastly|moreover|furthermore|additionally|however|therefore|thus|hence|nevertheless|nonetheless|indeed|also|next|overall|for example|for instance|in addition|in contrast|on the other hand|to begin with|by contrast|importantly|notably)\b/i;

function stageFuse(sentences, ctx) {
  const out = [];
  for (const s of sentences) {
    const prev = out[out.length - 1];
    // A sentence that opens with an expletive "there" cannot follow a
    // connector, because the connector would end up in front of the subject.
    const expletive = /^there\s+(?:is|are|was|were|exists?|remain)\b/i.test(s);
    const opener = SENTENCE_OPENER.test(s);
    if (prev && !expletive && !opener && prev.length < 80 && s.length < 80 && !/[?!]$/.test(prev) && ctx.gate('split')) {
      const connector = FUSION_CONNECTORS[Math.floor(ctx.rng() * FUSION_CONNECTORS.length)];
      out[out.length - 1] = prev.replace(/\.$/, '') + ', ' + connector + ' ' + lowerCaseOpener(s);
      ctx.fired('split');
    } else {
      out.push(s);
    }
  }
  return out;
}

function stageTransition(sentences, ctx) {
  const out = sentences.slice();
  for (let i = 1; i < out.length; i++) {
    if (!ctx.gate('transition')) continue;
    const s = out[i];
    if (!/^[a-z]/.test(s)) continue;
    const categories = entries(RULESET.transitions).map((e) => e[0]);
    const cat = categories[Math.floor(ctx.rng() * categories.length)];
    const pool = RULESET.transitions[cat].filter((p) => !ctx.usedTransitions.has(p));
    if (!pool.length) continue;
    const pick = pool[Math.floor(ctx.rng() * pool.length)];
    ctx.usedTransitions.add(pick);
    out[i] = pick.charAt(0).toUpperCase() + pick.slice(1) + ', ' + s;
    ctx.fired('transition');
  }
  return out;
}

// The marker pattern is built from the bank, so a user can add a marker
// without touching any code.
const DISCOURSE_RE = new RegExp(
  '\\b(' +
    Object.keys(RULESET.discourse)
      .filter((k) => !k.startsWith('_'))
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')\\b',
  'gi'
);

function stageDiscourse(sentences, ctx) {
  return sentences.map((s) =>
    s.replace(DISCOURSE_RE, (m) => {
      const key = m.toLowerCase();
      const options = RULESET.discourse[key];
      if (!options) return m;
      if (!ctx.gate('discourse')) return m;
      const fresh = options.filter((o) => !ctx.usedMarkers.has(key + '>' + o));
      if (!fresh.length) return m;
      const pick = fresh[Math.floor(ctx.rng() * fresh.length)];
      ctx.usedMarkers.add(key + '>' + pick);
      ctx.fired('discourse');
      return m[0] === m[0].toUpperCase() ? pick.charAt(0).toUpperCase() + pick.slice(1) : pick;
    })
  );
}

// A hedge belongs in front of a clause, not in front of the second item of a
// list and not in the middle of a noun phrase. The word after the comma has
// to be able to open a clause.
const HEDGE_CLAUSE_START = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'they', 'we', 'he',
  'she', 'i', 'you', 'its', 'their', 'our', 'his', 'her', 'there', 'and', 'but',
  'so', 'then', 'thus', 'hence', 'in', 'on', 'at', 'for', 'with', 'from', 'by',
  'as', 'when', 'while', 'after', 'before', 'since', 'if', 'because', 'although',
  'whereas', 'however', 'moreover', 'furthermore', 'additionally', 'consequently',
  'therefore', 'nevertheless', 'indeed', 'also', 'each', 'every', 'most', 'many',
  'some', 'several', 'both', 'all', 'no', 'one', 'two', 'three', 'such', 'this',
]);

// An adverbial that opens a sentence. A hedge belongs to the clause, not
// between such an adverbial and the subject that follows it.
const HEDGE_ADVERBIAL = /^(?:subsequently|meanwhile|overall|consequently|accordingly|firstly|secondly|thirdly|lastly|finally|initially|originally|hereby)$/i;

// A word that opens a subordinate clause. A hedge cannot sit between a
// subordinate clause and the main clause that follows it.
const SUBORDINATOR_WORDS = new Set([
  'when', 'while', 'after', 'before', 'since', 'if', 'unless', 'until',
  'because', 'although', 'though', 'whereas', 'once', 'as', 'given',
]);

function stageHedge(sentences, ctx) {
  let done = false;
  return sentences.map((s) => {
    if (done) return s;
    if (!ctx.gate('hedge')) return s;
    const idx = s.indexOf(', ');
    if (idx === -1 || idx > 70) return s;
    // The text after the comma has to carry a finite verb and has to be able
    // to open a clause. A comma inside a noun phrase, as in "a strategy,
    // capable of compensating", is not a place for a hedge.
    const tail = s.slice(idx + 2);
    if (!FINITE_VERB.test(tail)) return s;
    const first = (tail.match(/^[A-Za-z']+/) || [''])[0];
    // A hedge cannot go in front of a coordinating conjunction. In "it uses
    // energy, and it can destabilise the flight control system", a hedge
    // placed there reads as though it modifies "uses energy", and in "X,
    // ostensibly, and Y" the coordinate structure is broken. The clause after
    // a coordinating conjunction is not independent, so it takes no hedge.
    if (/^(and|but|so|yet|or|nor)\b/i.test(first)) return s;
    // A hedge belongs to a clause, so there has to be a clause before the
    // comma. After a subordinate clause, as in "When the controller
    // under-estimates the severity by 15 points", or after an adverbial, as
    // in "Under nominal conditions" or "Fourth", the comma does not open a
    // new clause and a hedge placed there hangs between the two parts.
    const lead = s.slice(0, idx).trim();
    if (!isClause(lead)) return s;
    // A subordinate clause is not a clause of its own. "When the icing is not
    // adapted to, often, the energy used goes up" puts the hedge inside the
    // condition, where it changes what the condition is. The first real word
    // is used, because an enumerative marker in front of the clause may be
    // masked by now, and the protected content is masked before the stages
    // run.
    const leadWord = (lead.replace(MASK_RE, ' ').match(/[A-Za-z]+/) || [''])[0].toLowerCase();
    if (SUBORDINATOR_WORDS.has(leadWord)) return s;
    // The clause in front of the comma has to be a main clause. If it ends in
    // a subordinate clause, as in "they also found that when the elevator is
    // iced", the comma does not open a new clause, and a hedge placed there
    // hangs between the two parts of the sentence.
    const leadTail = lead.includes(',')
      ? lead.slice(lead.lastIndexOf(',') + 1).trim()
      : lead;
    const tailWord = (leadTail.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
    if (SUBORDINATOR_WORDS.has(tailWord)) return s;
    if (lead.includes(' that ')) {
      const afterThat = lead.slice(lead.lastIndexOf(' that ') + 6).trim();
      const thatWord = (afterThat.match(/^[A-Za-z]+/) || [''])[0].toLowerCase();
      if (SUBORDINATOR_WORDS.has(thatWord)) return s;
    }
    const opensClause = HEDGE_CLAUSE_START.has(first.toLowerCase()) || /^[A-Z]/.test(first);
    if (!opensClause) return s;
    const pool = RULESET.hedges.filter((h) => !ctx.usedSynonyms.has('hedge>' + h));
    if (!pool.length) return s;
    const pick = pool[Math.floor(ctx.rng() * pool.length)];
    ctx.usedSynonyms.add('hedge>' + pick);
    done = true;
    ctx.fired('hedge');
    return s.slice(0, idx) + ', ' + pick + ',' + s.slice(idx + 1);
  });
}

function stageNominal(sentence, ctx) {
  if (sentence.length < 70) return sentence;
  if (!ctx.gate('nominal')) return sentence;
  const m = sentence.match(/^(The|A|An)\s+(\w+)\s+of\s+(.+)$/);
  if (!m) return sentence;
  const gerund = RULESET.nominalisations[m[2].toLowerCase()];
  if (!gerund) return sentence;
  ctx.fired('nominal');
  return m[1] + ' ' + gerund + ' ' + m[3];
}

function stageAppositive(sentence, ctx) {
  if (!ctx.gate('appositive')) return sentence;
  const terms = entries(RULESET.appositives)
    .map((e) => e[0])
    .sort((a, b) => b.length - a.length);
  for (const term of terms) {
    if (ctx.usedAppositives.has(term)) continue;
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![A-Za-z0-9])(' + esc + ')(?![A-Za-z0-9])', 'i');
    const m = sentence.match(re);
    if (!m) continue;
    const after = sentence.slice(m.index + m[0].length);
    if (/^\s+of\b/i.test(after)) continue;
    // The gloss is set off as an appositive, so the term must not be the head
    // of a prepositional phrase. "the binding constraint on public sector
    // digital transformation" cannot take an appositive before "on".
    if (/^\s+(on|in|for|with|to|from|at|by|between|among|during|across|within|under|over|regarding|through)\b/i.test(after)) continue;
    ctx.usedAppositives.add(term);
    ctx.fired('appositive');
    // The appositive is set off by a comma on each side, except when it ends
    // the sentence or already follows a comma, where a trailing comma would
    // produce punctuation such as "study,.".
    const tail = after.replace(/^\s+/, '');
    const closes = tail === '' || /^[.,;:]/.test(tail);
    const ins = ', ' + RULESET.appositives[term] + (closes ? '' : ',');
    return sentence.slice(0, m.index + m[0].length) + ins + sentence.slice(m.index + m[0].length);
  }
  return sentence;
}

// ---------------------------------------------------------------------------
// Stage 2: the stock words.
//
// A language model reaches for the same handful of words every time, because
// they are the safe choice. "Robust", "comprehensive", "crucial", "significantly"
// and "demonstrate" are the words of that choice. A detector reads them as
// machine-made, and so does a reader, although the reader does not know it.
//
// This stage is deterministic and always fires. The swaps in the bank are the
// safe ones, and a swap is refused whenever the word is part of a compound,
// carries a capital in the middle of a sentence, or would write a stock
// phrase that the audit would flag.
// ---------------------------------------------------------------------------

function stageTell(sentence, ctx) {
  let out = sentence;
  const bank = RULESET.tells || {};
  for (const [word, options] of entries(bank)) {
    if (!Array.isArray(options) || !options.length) continue;
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![A-Za-z0-9])(' + esc + ')(?![A-Za-z0-9])', 'gi');
    out = out.replace(re, (m, _g, offset, whole) => {
      // A masked token sits next to the match when the word was protected.
      const before = whole.charAt(offset - 1);
      const after = whole.charAt(offset + m.length);
      if (before === '\u0000' || after === '\u0000') return m;
      // A compound keeps its first half: "robust-augmented control" is the
      // name of a method and not a piece of stock wording.
      if (after === '-' || before === '-') return m;
      // A capital in the middle of a sentence is a name.
      const sentenceStart = offset === 0 || /[.!?]\s+$/.test(whole.slice(0, offset));
      if (!sentenceStart && m[0] === m[0].toUpperCase()) return m;
      // A capitalised word followed by another capitalised word is a name,
      // such as "Robust Control Strategies", and it is left alone.
      const nextWord = (whole.slice(offset + m.length).match(/^\s+([A-Za-z]+)/) || ['', ''])[1];
      if (nextWord && /^[A-Z]/.test(nextWord) && m[0] === m[0].toUpperCase()) return m;
      const lower = m.toLowerCase();
      const form = detectForm(lower).form;
      const usable = options.filter((o) => {
        if (form === 'adverb' && detectForm(o).form === 'adverb') return true;
        if (form === 'adverb') return !/ly$/.test(o);
        return true;
      });
      if (!usable.length) return m;
      const replacement = inflectMatch(usable[0], m);
      if (replacement.toLowerCase() === lower) return m;
      const candidate = whole.slice(0, offset) + replacement + whole.slice(offset + m.length);
      if (!containsTrigger(whole) && containsTrigger(candidate)) return m;
      ctx.fired('tell');
      return replacement;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stage 13: cadence repair.
//
// A detector reads the rhythm of a paragraph before it reads anything else.
// When every sentence in a paragraph is the same length, the paragraph holds
// one note, and that is the shape a classifier looks for. This stage
// measures the paragraph and repairs it only when it is flat. It never
// invents content: a repair is either a cut at a conjunction where both
// sides are clauses of their own, or a join of two short neighbours.
// ---------------------------------------------------------------------------

// The words that may start a main clause that has been moved behind a
// fronted clause. A name keeps its capital.
const MAIN_LOWERABLE = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'they', 'he',
  'she', 'we', 'its', 'their', 'our', 'his', 'her', 'my', 'your', 'such',
]);

function lowerMainClause(main) {
  const m = main.match(/^[A-Za-z]+/);
  if (!m) return main;
  const word = m[0];
  if (!MAIN_LOWERABLE.has(word.toLowerCase())) return main;
  return word.charAt(0).toLowerCase() + word.slice(1) + main.slice(word.length);
}

function rhythmOptions(ctx) {
  return {
    isClause,
    verbIndex,
    lowerCaseOpener,
    isBlockedOpener: (s) => SENTENCE_OPENER.test(s),
    canLower: lowerMainClause,
    config: RULESET.rhythm || {},
  };
}

function stageCadence(sentences, ctx) {
  const result = repairCadence(sentences, rhythmOptions(ctx));
  if (result.actions.length) ctx.fired('cadence', result.actions.length);
  return result.sentences;
}

// ---------------------------------------------------------------------------
// Stage 14: opener variation.
//
// Two sentences that open with the same two words are one of the easiest
// habits for a reader to notice and one of the easiest for a classifier to
// count. Where a sentence can take a fronted clause, it is given one, so the
// opening changes while the meaning does not.
// ---------------------------------------------------------------------------

function stageOpener(sentences, ctx) {
  if (!ctx.gate('opener')) return sentences;
  const result = varyOpeners(sentences, rhythmOptions(ctx));
  if (result.actions.length) ctx.fired('opener', result.actions.length);
  return result.sentences;
}

// ---------------------------------------------------------------------------
// Stage 15: document rhythm.
//
// The stage above works inside a paragraph. A document has its own habit: the
// same opening can head ten paragraphs in a row, one after another, with a
// page between them. This stage sees the whole sequence of paragraphs and
// gives the repeated openings a different one where that can be done safely.
// ---------------------------------------------------------------------------

function documentRhythm(texts, ctx) {
  const limit = (RULESET.rhythm && RULESET.rhythm.openerLimit) || 2;
  const counts = new Map();
  for (const t of texts) {
    const key = openerKey(t, 2);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const changed = [];
  for (let i = 0; i < texts.length; i++) {
    const key = openerKey(texts[i], 2);
    if (!key || (counts.get(key) || 0) <= limit) continue;
    const sentences = splitSentences(texts[i]);
    if (!sentences.length) continue;
    const candidate = frontCandidate(sentences[0], rhythmOptions(ctx));
    if (!candidate) continue;
    const newKey = openerKey(candidate, 2);
    if (newKey === key) continue;
    const rest = texts[i].slice(sentences[0].length);
    changed.push({ index: i, before: texts[i], after: candidate + rest });
    texts[i] = candidate + rest;
    counts.set(key, (counts.get(key) || 0) - 1);
    counts.set(newKey, (counts.get(newKey) || 0) + 1);
    ctx.fired('document');
  }
  return { texts, changed };
}

// ---------------------------------------------------------------------------
// Stage 16: deterministic final chain breaking against the source.
// ---------------------------------------------------------------------------

function tokenizeWords(text) {
  // The same tokeniser as audit.mjs is used here, so that a chain the engine
  // believes it has broken is also gone as far as the audit is concerned.
  return tokenize(text).map((t) => ({ w: t.token, start: t.start, end: t.end }));
}

function findChains(text, sourceTokens, k = 5) {
  const toks = tokenizeWords(text);
  const index = new Map();
  for (let i = 0; i + k <= sourceTokens.length; i++) {
    const key = sourceTokens.slice(i, i + k).join(' ');
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(i);
  }
  const raw = [];
  for (let i = 0; i + k <= toks.length; i++) {
    const key = toks.slice(i, i + k).map((t) => t.w).join(' ');
    const positions = index.get(key);
    if (!positions) continue;
    for (const p of positions) {
      let back = 0;
      while (i - back - 1 >= 0 && p - back - 1 >= 0 && toks[i - back - 1].w === sourceTokens[p - back - 1]) back++;
      let fwd = k;
      while (i + fwd < toks.length && p + fwd < sourceTokens.length && toks[i + fwd].w === sourceTokens[p + fwd]) fwd++;
      raw.push({ startA: i - back, len: back + fwd });
    }
  }
  raw.sort((a, b) => a.startA - b.startA);
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.startA < last.startA + last.len) {
      if (r.startA + r.len > last.startA + last.len) last.len = r.startA + r.len - last.startA;
      continue;
    }
    merged.push({ ...r });
  }
  return merged.filter((r) => r.len >= k).map((r) => ({ ...r, toks }));
}

// Connectives that can be expanded into a longer, still grammatical form. An
// expansion inserts an extra word, which breaks a matched run that no single
// word swap could reach, because the run consists of function words.
//
// The expansions avoid the constructions on the audit's machine-phrase list,
// so the engine never introduces a phrase that the audit then flags.
const CHAIN_EXPANSIONS = {
  but: ['and yet', 'yet'],
  and: ['and also', 'as well as'],
  or: ['or alternatively', 'or even'],
  itself: ['in itself', 'on its own'],
};

/**
 * Attempt to break one matched chain by changing a single token inside it.
 * Four strategies are tried, in descending order of quality:
 *   1. replace a phrase from the rule bank that covers the token
 *   2. expand a connective into its longer grammatical form
 *   3. swap the token for a synonym, inflected to match the original form
 *   4. swap a determiner for a grammatical alternative
 * Returns the new text, or null when no strategy applies.
 */
function attemptBreak(text, token, ctx) {
  const word = token.w;
  const original = text.slice(token.start, token.end);

  // 1. Phrase replacement covering this token.
  for (const [phrase, replacement] of RULESET.phrases) {
    if (!replacement) continue;
    const phraseWords = phrase.toLowerCase().split(/\s+/);
    if (!phraseWords.includes(word)) continue;
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?<![A-Za-z0-9])' + esc + '(?![A-Za-z0-9])', 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index <= token.start && token.end <= m.index + m[0].length) {
        let rep = replacement;
        if (m[0][0] === m[0][0].toUpperCase() && rep[0] === rep[0].toLowerCase()) {
          rep = rep.charAt(0).toUpperCase() + rep.slice(1);
        }
        ctx.fired('chainPhrase');
        return text.slice(0, m.index) + rep + text.slice(m.index + m[0].length);
      }
    }
  }

  // 2. Connective expansion.
  const expansions = CHAIN_EXPANSIONS[word];
  if (expansions) {
    const pick = expansions[Math.floor(ctx.rng() * expansions.length)];
    ctx.fired('chainExpansion');
    return text.slice(0, token.start) + pick + text.slice(token.end);
  }

  // 2. Synonym swap with matched inflection.
  if (RELATIVE_CUE_AFTER.test(text.slice(token.end))) return null;
  const lemma = detectForm(word).lemma;
  const pos = guessPos(text, token.start);
  const entry = RULESET.synonyms[lemma];
  const explicitPos = entry && !Array.isArray(entry);
  const rawPool = poolFor(lemma, word, pos) || [];
  const eligible = rawPool.filter((s) => {
    if (/\s/.test(s)) {
      return explicitPos && pos === 'noun' && detectForm(word).form === 'base';
    }
    return true;
  });
  const fresh = eligible.filter((s) => !ctx.usedSynonyms.has('chain>' + lemma + '>' + s));
  // Prefer an unused replacement so the prose keeps its variety, but fall back
  // to a reused one rather than leaving a chain unbroken.
  const pool = fresh.length ? fresh : eligible;
  if (pool.length) {
    const pick = pool[Math.floor(ctx.rng() * pool.length)];
    const replacement = inflectMatch(pick, original);
    if (replacement.toLowerCase() !== word) {
      ctx.usedSynonyms.add('chain>' + lemma + '>' + pick);
      ctx.fired('chain');
      return text.slice(0, token.start) + replacement + text.slice(token.end);
    }
  }

  // 3. Determiner swap.
  const det = RULESET.determiners[word];
  if (det) {
    const usable = det.filter((o) => !/\s/.test(o));
    if (usable.length) {
      const pick = usable[Math.floor(ctx.rng() * usable.length)];
      ctx.fired('chainDeterminer');
      return text.slice(0, token.start) + pick + text.slice(token.end);
    }
  }

  return null;
}

/** Choose the token inside a chain that sits closest to its midpoint. */
function chainCandidates(chain) {
  const mid = Math.floor(chain.len / 2);
  const out = [];
  for (let d = 0; d < chain.len; d++) {
    const rel = d % 2 === 0 ? mid + d / 2 : mid - (d + 1) / 2;
    if (rel >= 0 && rel < chain.len) out.push(chain.startA + rel);
  }
  return out;
}

/**
 * Stage 12: deterministic final chain breaking against the source.
 *
 * The loop runs until no matched run of eight words or more remains, so a long
 * verbatim passage is broken at every seventh word rather than at one point.
 * A single break only halves a run, which is not enough to clear the
 * eight-word threshold on its own.
 */
function breakChains(text, sourceTokens, ctx, maxPasses = 120) {
  let out = text;
  for (let pass = 0; pass < maxPasses; pass++) {
    const chains = findChains(out, sourceTokens, 5);
    const risky = chains.filter((c) => c.len >= 8).sort((a, b) => b.len - a.len);
    if (!risky.length) break;

    let progressed = false;
    for (const chain of risky) {
      for (const idx of chainCandidates(chain)) {
        const token = chain.toks[idx];
        if (!token) continue;
        const broke = attemptBreak(out, token, ctx);
        if (broke) {
          out = fixArticles(broke);
          progressed = true;
          break;
        }
      }
      if (progressed) break;
    }

    if (!progressed) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paragraph driver
// ---------------------------------------------------------------------------

function transformParagraph(paragraph, ctx, sourceTokens) {
  if (!paragraph.trim()) return paragraph;
  if (paragraph.length < 40) return paragraph;

  const { masked, tokens } = protect(paragraph);

  let sentences = splitSentences(masked);
  if (!sentences.length) return paragraph;

  sentences = sentences.map((s) => {
    let t = stagePhrases(s, ctx);
    t = stageTell(t, ctx);
    if (!ctx.safe) {
      t = stageSynonyms(t, ctx);
      t = stageDeterminers(t, ctx);
      t = stageClause(t, ctx);
      t = stageVoice(t, ctx);
      t = stageSplit(t, ctx);
      t = stageNominal(t, ctx);
      t = stageAppositive(t, ctx);
    }
    return t;
  });

  if (!ctx.safe) {
    sentences = stageFuse(sentences, ctx);
    sentences = stageTransition(sentences, ctx);
    sentences = stageDiscourse(sentences, ctx);
    sentences = stageHedge(sentences, ctx);
  }
  sentences = stageCadence(sentences, ctx);
  sentences = stageOpener(sentences, ctx);

  let out = sentences.join(' ').replace(/\s{2,}/g, ' ').trim();
  out = restore(out, tokens);
  out = fixArticles(out);

  if (sourceTokens && sourceTokens.length) {
    out = breakChains(out, sourceTokens, ctx);
  }

  return fixArticles(out);
}

// ---------------------------------------------------------------------------
// DOCX handling
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function docxParagraphs(buf) {
  const entries = readZip(buf);
  const doc = entries.find((e) => e.name.replace(/\\/g, '/') === 'word/document.xml');
  if (!doc) throw new Error('word/document.xml not found');
  const xml = doc.data.toString('utf8');

  // Offsets of every table, so that paragraphs inside a table can be skipped.
  const tableRanges = [];
  const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let t;
  while ((t = tblRe.exec(xml)) !== null) {
    tableRanges.push([t.index, t.index + t[0].length]);
  }

  const out = [];
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(xml)) !== null) {
    const inner = m[1];
    const texts = [];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let tt;
    while ((tt = tRe.exec(inner)) !== null) texts.push(decodeEntities(tt[1]));
    const joined = texts.join('');
    const style = (inner.match(/<w:pStyle\s+w:val="([^"]+)"/) || [])[1] || '';

    // Every run in the paragraph must carry the same run properties, otherwise
    // replacing the paragraph text would flatten the mixed formatting.
    const props = new Set();
    const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    let r;
    while ((r = runRe.exec(inner)) !== null) {
      const rPr = r[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/);
      props.add(rPr ? rPr[0] : '');
    }

    const inTable = tableRanges.some(([a, b]) => m.index >= a && m.index < b);

    // A paragraph whose runs are all italic is a caption or a note rather than
    // body prose, whatever style it carries.
    const propList = [...props];
    const italicAll = propList.length > 0 && propList.every((p) => /<w:i\s*\/>/.test(p));

    const align = (inner.match(/<w:jc\b[^>]*w:val="([^"]+)"[^>]*\/>/) || [])[1] || '';

    // A paragraph that holds anything other than plain text cannot be
    // rebuilt, so it is left alone. A paragraph whose runs differ in their
    // properties, for example a citation whose "et al." is italic, can be
    // rebuilt word by word, so it is not left alone.
    const simple = !/<w:(hyperlink|fldSimple|instrText|bookmarkStart|drawing|pict|footnoteReference|endnoteReference|commentReference|sdt)\b/.test(inner);

    out.push({
      text: joined,
      style,
      offset: m.index,
      uniform: props.size <= 1,
      simple,
      italicAll,
      align,
      inTable,
    });
  }
  return { paragraphs: out, xml };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { input: null, out: null, source: null, plan: null, intensity: 'standard', dryRun: false, seed: 20261026, rules: null, safe: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--source') args.source = argv[++i];
    else if (a === '--plan') args.plan = argv[++i];
    else if (a === '--intensity') args.intensity = argv[++i];
    else if (a === '--seed') args.seed = parseInt(argv[++i], 10) || 20261026;
    else if (a === '--rules') args.rules = argv[++i];
    else if (a === '--safe') args.safe = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (!a.startsWith('-') && !args.input) args.input = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  console.error('Usage: node scripts/transform.mjs <file> --out <file> [--source <file>] [--intensity light|standard|heavy|max] [--plan <plan.json>] [--rules <dir>] [--safe] [--dry-run]');
  process.exit(2);
}
if (!existsSync(args.input)) {
  console.error('transform failed: file not found: ' + args.input);
  process.exit(1);
}

// A different bank directory lets a user keep a discipline-specific set of
// protected terms without changing the shared banks.
if (args.rules) {
  if (!existsSync(args.rules)) {
    console.error('transform failed: rules directory not found: ' + args.rules);
    process.exit(1);
  }
  RULESET = loadRuleSet(args.rules);
}

const ctx = createContext(args);
let sourceTokens = [];
if (args.source && existsSync(args.source)) {
  const srcText = extractText(args.source).text;
  sourceTokens = tokenizeWords(srcText).map((t) => t.w);
}

const isDocx = args.input.toLowerCase().endsWith('.docx');
const report = { file: args.input, intensity: args.intensity, stages: {}, changes: [] };

try {
  if (isDocx) {
    const { paragraphs } = docxParagraphs(readFileSync(args.input));
    const plan = [];
    const skipped = [];
    const work = [];

    // The parts of the document that must not move are recognised from their
    // content, because a manuscript does not have to use Word heading styles.
    const kinds = classifySequence(
      paragraphs.map((p) => ({ text: p.text, style: p.style, italicAll: p.italicAll, align: p.align }))
    );

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      const kind = kinds[i];
      if (!p.text.trim() || p.text.length < 40) continue;
      if (/^(Heading|Title|Subtitle)/i.test(p.style)) continue;
      // Table cells and paragraphs with mixed run formatting are left for a
      // human or an agent, because rewriting them would damage the layout.
      if (p.inTable) {
        skipped.push({ text: p.text.slice(0, 70), reason: 'inside a table' });
        continue;
      }
      if (kind !== 'prose') {
        skipped.push({ text: p.text.slice(0, 70), reason: kind });
        continue;
      }
      if (!p.simple) {
        skipped.push({ text: p.text.slice(0, 70), reason: 'holds more than plain text' });
        continue;
      }
      const transformed = transformParagraph(p.text, ctx, sourceTokens);
      work.push({ old: p.text, text: transformed });
    }

    // The document rhythm pass needs the whole sequence of prose paragraphs,
    // because the habit it repairs is one that repeats across pages.
    if (work.length) {
      const texts = work.map((w) => w.text);
      const rhythm = documentRhythm(texts, ctx);
      for (let i = 0; i < work.length; i++) work[i].text = rhythm.texts[i];
    }

    for (const w of work) {
      if (w.text !== w.old) {
        plan.push({ old: w.old, new: w.text, paragraph: true });
        report.changes.push({ style: '', before: w.old.slice(0, 90), after: w.text.slice(0, 90) });
      }
    }
    report.stages = ctx.counts;
    report.skipped = skipped;
    if (args.plan) {
      writeFileSync(args.plan, JSON.stringify({ replace: plan }, null, 2), 'utf8');
      report.plan = args.plan;
      report.planEntries = plan.length;
    }
    if (args.out && !args.dryRun && !args.plan) {
      console.error('transform: for a .docx input, write a plan with --plan and apply it with rewrite-docx.mjs');
      process.exit(1);
    }
  } else {
    const text = readFileSync(args.input, 'utf8');
    const paragraphs = text.split(/\n{2,}/);
    const kinds = classifySequence(paragraphs.map((p) => ({ text: p, style: '' })));
    const outParagraphs = paragraphs.map((p, i) =>
      kinds[i] === 'prose' ? transformParagraph(p, ctx, sourceTokens) : p
    );
    // The document rhythm pass sees the prose paragraphs in the order they
    // appear, so that a repeated opening can be broken across the document.
    const proseIndexes = outParagraphs.map((_, i) => i).filter((i) => kinds[i] === 'prose');
    if (proseIndexes.length) {
      const texts = proseIndexes.map((i) => outParagraphs[i]);
      const rhythm = documentRhythm(texts, ctx);
      proseIndexes.forEach((i, k) => { outParagraphs[i] = rhythm.texts[k]; });
    }
    const outText = outParagraphs.join('\n\n');
    report.stages = ctx.counts;
    report.changed = outText !== text;
    if (!args.dryRun && args.out) writeFileSync(args.out, outText, 'utf8');
    report.output = args.out;
  }
} catch (err) {
  console.error('transform failed: ' + err.message);
  process.exit(1);
}

console.log('=== transform report ===');
console.log('  intensity   : ' + args.intensity + ' (effective ' + (ctx.k * 100).toFixed(0) + ' percent)');
for (const [stage, count] of Object.entries(report.stages)) {
  console.log('  ' + stage.padEnd(12) + ': ' + count);
}
if (report.planEntries !== undefined) {
  console.log('  plan entries: ' + report.planEntries + ' -> ' + report.plan);
}
if (report.skipped && report.skipped.length) {
  console.log('  skipped     : ' + report.skipped.length + ' paragraph(s) left for review');
  for (const s of report.skipped.slice(0, 6)) {
    console.log('    - [' + s.reason + '] ' + s.text.replace(/\s+/g, ' ').slice(0, 60));
  }
}
if (report.output) console.log('  written     : ' + report.output);
if (report.changed === false) console.log('  no change produced');
console.log('  Review every change before using the output. No score is guaranteed.');
