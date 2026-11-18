// lib-inflect.mjs — morphological inflection matching for synonym substitution.
//
// When a synonym replaces a word, the replacement has to carry the same grammatical
// form as the original: plural, third person, past tense, participle, gerund or
// adverb. Substituting the bare lemma produces broken sentences such as "The results
// analyses show". This module inflects a replacement so it matches its context.
//
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved.
// Part of the Plagiarism-minimiser-KDBN project. See LICENSE in the repository root.

const IRREGULAR = {
  be: { third: 'is', past: 'was', participle: 'been', gerund: 'being' },
  am: { third: 'is', past: 'was', participle: 'been', gerund: 'being' },
  is: { third: 'is', past: 'was', participle: 'been', gerund: 'being' },
  are: { third: 'are', past: 'were', participle: 'been', gerund: 'being' },
  was: { third: 'is', past: 'was', participle: 'been', gerund: 'being' },
  were: { third: 'are', past: 'were', participle: 'been', gerund: 'being' },
  been: { third: 'is', past: 'was', participle: 'been', gerund: 'being' },
  begin: { third: 'begins', past: 'began', participle: 'begun', gerund: 'beginning' },
  break: { third: 'breaks', past: 'broke', participle: 'broken', gerund: 'breaking' },
  build: { third: 'builds', past: 'built', participle: 'built', gerund: 'building' },
  choose: { third: 'chooses', past: 'chose', participle: 'chosen', gerund: 'choosing' },
  come: { third: 'comes', past: 'came', participle: 'come', gerund: 'coming' },
  do: { third: 'does', past: 'did', participle: 'done', gerund: 'doing' },
  draw: { third: 'draws', past: 'drew', participle: 'drawn', gerund: 'drawing' },
  find: { third: 'finds', past: 'found', participle: 'found', gerund: 'finding' },
  give: { third: 'gives', past: 'gave', participle: 'given', gerund: 'giving' },
  grow: { third: 'grows', past: 'grew', participle: 'grown', gerund: 'growing' },
  hold: { third: 'holds', past: 'held', participle: 'held', gerund: 'holding' },
  keep: { third: 'keeps', past: 'kept', participle: 'kept', gerund: 'keeping' },
  know: { third: 'knows', past: 'knew', participle: 'known', gerund: 'knowing' },
  lead: { third: 'leads', past: 'led', participle: 'led', gerund: 'leading' },
  leave: { third: 'leaves', past: 'left', participle: 'left', gerund: 'leaving' },
  lose: { third: 'loses', past: 'lost', participle: 'lost', gerund: 'losing' },
  make: { third: 'makes', past: 'made', participle: 'made', gerund: 'making' },
  mean: { third: 'means', past: 'meant', participle: 'meant', gerund: 'meaning' },
  meet: { third: 'meets', past: 'met', participle: 'met', gerund: 'meeting' },
  prove: { third: 'proves', past: 'proved', participle: 'proved', gerund: 'proving' },
  put: { third: 'puts', past: 'put', participle: 'put', gerund: 'putting' },
  read: { third: 'reads', past: 'read', participle: 'read', gerund: 'reading' },
  run: { third: 'runs', past: 'ran', participle: 'run', gerund: 'running' },
  say: { third: 'says', past: 'said', participle: 'said', gerund: 'saying' },
  see: { third: 'sees', past: 'saw', participle: 'seen', gerund: 'seeing' },
  seek: { third: 'seeks', past: 'sought', participle: 'sought', gerund: 'seeking' },
  show: { third: 'shows', past: 'showed', participle: 'shown', gerund: 'showing' },
  take: { third: 'takes', past: 'took', participle: 'taken', gerund: 'taking' },
  teach: { third: 'teaches', past: 'taught', participle: 'taught', gerund: 'teaching' },
  tell: { third: 'tells', past: 'told', participle: 'told', gerund: 'telling' },
  think: { third: 'thinks', past: 'thought', participle: 'thought', gerund: 'thinking' },
  undergo: { third: 'undergoes', past: 'underwent', participle: 'undergone', gerund: 'undergoing' },
  undertake: { third: 'undertakes', past: 'undertook', participle: 'undertaken', gerund: 'undertaking' },
  overcome: { third: 'overcomes', past: 'overcame', participle: 'overcome', gerund: 'overcoming' },
  understand: { third: 'understands', past: 'understood', participle: 'understood', gerund: 'understanding' },
  write: { third: 'writes', past: 'wrote', participle: 'written', gerund: 'writing' },
  arise: { third: 'arises', past: 'arose', participle: 'arisen', gerund: 'arising' },
  become: { third: 'becomes', past: 'became', participle: 'become', gerund: 'becoming' },
  bear: { third: 'bears', past: 'bore', participle: 'borne', gerund: 'bearing' },
  arise_: { third: 'arises', past: 'arose', participle: 'arisen', gerund: 'arising' },
};

const IRREGULAR_REVERSE = (() => {
  const map = new Map();
  for (const [lemma, forms] of Object.entries(IRREGULAR)) {
    if (lemma.endsWith('_')) continue;
    for (const [form, value] of Object.entries(forms)) {
      if (form === 'third') continue;
      if (!map.has(value)) map.set(value, lemma);
    }
  }
  return map;
})();

// The third person form of an irregular verb looks exactly like a plural
// noun, so "shows" used to be read as the plural of "show". Without this map
// the engine writes "showes" when it swaps "demonstrates" for "shows".
const IRREGULAR_THIRD = (() => {
  const map = new Map();
  for (const [lemma, forms] of Object.entries(IRREGULAR)) {
    if (lemma.endsWith('_')) continue;
    if (forms.third && !IRREGULAR_REVERSE.has(forms.third)) map.set(forms.third, lemma);
  }
  return map;
})();

const IRREGULAR_PLURALS = {
  analysis: 'analyses',
  basis: 'bases',
  crisis: 'crises',
  thesis: 'theses',
  hypothesis: 'hypotheses',
  diagnosis: 'diagnoses',
  emphasis: 'emphases',
  synthesis: 'syntheses',
  synopsis: 'synopses',
  parenthesis: 'parentheses',
  stimulus: 'stimuli',
  criterion: 'criteria',
  phenomenon: 'phenomena',
  index: 'indices',
  matrix: 'matrices',
  appendix: 'appendices',
  datum: 'data',
};

const VOWELS = 'aeiou';
const DOUBLE_ENDINGS = ['ss', 'sh', 'ch', 'x', 'z'];

function endsWithDoubleC(word) {
  // consonant-vowel-consonant, where the final consonant is not w, x or y
  if (word.length < 3) return false;
  const last = word[word.length - 1];
  const mid = word[word.length - 2];
  const first = word[word.length - 3];
  if (VOWELS.includes(first)) return false;
  if (VOWELS.includes(mid)) return false;
  if (VOWELS.includes(last)) return false;
  if (['w', 'x', 'y'].includes(last)) return false;
  if (DOUBLE_ENDINGS.includes(word.slice(-2))) return false;
  return true;
}

function addS(lemma) {
  if (IRREGULAR_PLURALS[lemma]) return IRREGULAR_PLURALS[lemma];
  // Latin "-sis" nouns: analysis -> analyses, thesis -> theses, basis -> bases.
  if (lemma.endsWith('sis')) {
    return lemma.slice(0, -3) + 'ses';
  }
  if (lemma.endsWith('s') || lemma.endsWith('x') || lemma.endsWith('z') || lemma.endsWith('ch') || lemma.endsWith('sh')) {
    return lemma + 'es';
  }
  if (lemma.endsWith('y') && !VOWELS.includes(lemma[lemma.length - 2])) {
    return lemma.slice(0, -1) + 'ies';
  }
  if (lemma.endsWith('o')) return lemma + 'es';
  return lemma + 's';
}

function addED(lemma) {
  if (lemma.endsWith('e')) return lemma + 'd';
  if (lemma.endsWith('y') && !VOWELS.includes(lemma[lemma.length - 2])) {
    return lemma.slice(0, -1) + 'ied';
  }
  if (endsWithDoubleC(lemma)) return lemma + lemma[lemma.length - 1] + 'ed';
  return lemma + 'ed';
}

function addING(lemma) {
  if (lemma.endsWith('e') && !lemma.endsWith('ee')) return lemma.slice(0, -1) + 'ing';
  if (endsWithDoubleC(lemma)) return lemma + lemma[lemma.length - 1] + 'ing';
  return lemma + 'ing';
}

function addLY(word) {
  if (word.endsWith('ic')) return word + 'ally';
  if (word.endsWith('le') && word.length > 2 && !VOWELS.includes(word[word.length - 3])) {
    return word.slice(0, -1) + 'y';
  }
  if (word.endsWith('y') && !VOWELS.includes(word[word.length - 2])) {
    return word.slice(0, -1) + 'ily';
  }
  return word + 'ly';
}

/**
 * Work out the grammatical form of a word and its lemma.
 * form is one of: base, third, plural, past, participle, gerund, adverb, unknown
 */
export function detectForm(word) {
  const lower = word.toLowerCase();

  if (IRREGULAR_REVERSE.has(lower)) {
    const lemma = IRREGULAR_REVERSE.get(lower);
    const forms = IRREGULAR[lemma];
    if (lower === forms.past) return { lemma, form: 'past' };
    if (lower === forms.participle && forms.past !== forms.participle) {
      return { lemma, form: 'participle' };
    }
    if (lower === forms.gerund) return { lemma, form: 'gerund' };
  }

  if (lower.endsWith('ly') && lower.length > 4) {
    const stem = lower.slice(0, -2);
    if (stem.endsWith('i')) return { lemma: stem.slice(0, -1) + 'y', form: 'adverb' };
    if (stem.endsWith('le') && !VOWELS.includes(stem[stem.length - 3])) {
      return { lemma: stem.slice(0, -1), form: 'adverb' };
    }
    return { lemma: stem, form: 'adverb' };
  }

  if (lower.endsWith('ing') && lower.length > 5) {
    let stem = lower.slice(0, -3);
    if (stem.endsWith('i')) stem = stem.slice(0, -1) + 'y';
    if (endsWithDoubleC(stem)) stem = stem.slice(0, -1);
    return { lemma: stem, form: 'gerund' };
  }

  if (lower.endsWith('ied') && lower.length > 4) {
    return { lemma: lower.slice(0, -3) + 'y', form: 'past' };
  }

  if (lower.endsWith('ed') && lower.length > 3) {
    let stem = lower.slice(0, -2);
    if (endsWithDoubleC(stem)) stem = stem.slice(0, -1);
    return { lemma: stem, form: 'past' };
  }

  if (lower.endsWith('ies') && lower.length > 4) {
    return { lemma: lower.slice(0, -3) + 'y', form: 'plural' };
  }

  if (IRREGULAR_THIRD.has(lower)) {
    return { lemma: IRREGULAR_THIRD.get(lower), form: 'third' };
  }

  if (lower.endsWith('es') && lower.length > 3) {
    // Only "boxes" and "watches" lose the "es". "demonstrates" loses the "s"
    // and keeps its own "e", so the stem must not be cut to "demonstrat".
    if (/(?:ss|sh|ch|x|z|o)es$/.test(lower)) return { lemma: lower.slice(0, -2), form: 'third' };
    return { lemma: lower.slice(0, -1), form: 'third' };
  }

  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 2) {
    return { lemma: lower.slice(0, -1), form: 'plural' };
  }

  return { lemma: lower, form: 'base' };
}

/**
 * Inflect a replacement lemma so it matches the form of the original word.
 * Returns the inflected word, capitalised if the original was capitalised.
 */
export function inflectMatch(replacement, originalWord) {
  const cap = /^[A-Z]/.test(originalWord);

  // A multi-word replacement cannot be inflected word by word without the caller
  // supplying the original phrase, so it is returned unchanged apart from
  // capitalisation. Multi-word entries are only used for bare singular nouns.
  if (/\s/.test(replacement)) {
    return cap ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
  }

  const { lemma: targetLemma, form } = detectForm(originalWord);

  // A replacement that already carries the form of the original keeps it.
  // Without this check "shows" would be turned into "showses" when it stood
  // in for "demonstrates".
  const replacementForm = detectForm(replacement).form;
  if (replacementForm === form && form !== 'base') {
    return cap ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
  }

  let out = replacement;

  if (IRREGULAR[targetLemma]) {
    const forms = IRREGULAR[targetLemma];
    if (form === 'third' && forms.third) out = forms.third;
    else if (form === 'past' && forms.past) out = forms.past;
    else if (form === 'participle' && forms.participle) out = forms.participle;
    else if (form === 'gerund' && forms.gerund) out = forms.gerund;
  } else if (form === 'third') {
    out = addS(replacement);
  } else if (form === 'past' || form === 'participle') {
    out = addED(replacement);
  } else if (form === 'gerund') {
    out = addING(replacement);
  } else if (form === 'adverb') {
    // A replacement that is already an adverb keeps its form, otherwise
    // "incompetently" would become "incompetentlily".
    out = /ly$/i.test(replacement) ? replacement : addLY(replacement);
  } else if (form === 'plural') {
    out = addS(replacement);
  }

  if (cap) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

/** Inflect a whole replacement phrase, word by word, matching the original words. */
export function inflectPhrase(replacementPhrase, originalPhrase) {
  const rWords = replacementPhrase.split(/\s+/);
  const oWords = originalPhrase.split(/\s+/);
  if (rWords.length !== oWords.length) return replacementPhrase;
  return rWords.map((w, i) => inflectMatch(w, oWords[i])).join(' ');
}

export function isVerbLike(lemma) {
  return Object.prototype.hasOwnProperty.call(IRREGULAR, lemma);
}
