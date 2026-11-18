# Detection mechanics

What similarity engines and AI detectors actually measure, and which transformation
breaks which signal. This is the reasoning layer behind the transformation ladder in
`transformation-rules.md`.

## 1. The similarity layer: winnowing and fingerprinting

Document fingerprinting systems in the MMW family (used by Turnitin, iThenticate and
similar services) work like this:

1. **Normalise.** Lowercase, strip punctuation, strip whitespace, strip formatting.
   Capitalisation and punctuation changes are invisible to the comparison, so they
   achieve nothing.
2. **Slide a k-gram window.** Word-level k-grams, with k = 5 in the widely documented
   reference configuration.
3. **Hash each k-gram.** A Rabin-Karp rolling hash. The hash is order dependent, so
   the same words in a different order hash to a completely different value. Changing
   one word inside a 5-gram window also changes the hash completely.
4. **Winnow.** Slide a window of w hashes (w = 4 in the reference configuration) and
   keep only the minimum hash in each window. This produces a sparse fingerprint set
   that ignores where in the document the match occurred.
5. **Compare.** Fingerprints are looked up against the corpus. A match means a shared
   passage.

**The detection guarantee.** Winnowing guarantees that two texts sharing a passage of
at least k + w - 1 consecutive words will always share at least one fingerprint. With
k = 5 and w = 4 that is 8 consecutive words. Passages of 1 to 4 shared words are never
matched. Passages of 5 to 7 words are matched only sometimes, depending on which hash
wins the window.

**What this means in practice.** The unit of risk is a run of 5 or more identical words.
Break every run of 5, and no fingerprint can match. Runs of 8 or more are the ones that
always get caught, so they are the priority.

Turnitin does not publish its exact configuration, and the k and w values above are the
documented defaults for this algorithm family, so treat them as the working reference
rather than confirmed internals.

**Clustering.** Adjacent matching fingerprints are grouped into matched passages.
Isolated single matches are treated as coincidence and ignored. A cluster of several
adjacent matches is what produces the reported percentage, which is roughly the
proportion of the document's words that sit inside matched passages.

**Exclusions.** Bibliography entries, quoted text, and reference material are normally
excluded from the percentage. Citations and reference lists are therefore not where the
score comes from, and rewriting them changes nothing.

## 2. The structural layer: syntax tree matching

Synonym substitution leaves the part-of-speech sequence and the dependency structure
untouched. Modern similarity systems parse the sentence into a dependency tree and
compare tree shapes, using tree edit distance (the minimum number of node insertions,
deletions and substitutions needed to turn one tree into the other).

To move a sentence's tree, change the shape, not the words:

| Transformation | Tree effect |
|---|---|
| Active to passive voice | Swaps the subject and object node roles |
| Clause split | Turns one root tree into two independent trees |
| Sentence fusion | Merges two trees under a coordinating node |
| Nominalisation | Replaces a verbal subtree with a noun phrase subtree |
| Prepositional fronting | Moves a modifier branch to the root position |
| Appositive insertion | Adds a sibling node to a noun node |

Rule of thumb from the literature and from practice: two independent structural edits
per substantive sentence drops the structural similarity below the flag threshold.
One edit leaves the shape recognisable.

## 3. The semantic layer: embedding similarity

Scanners encode sentences with a Transformer such as Sentence-BERT and compare with
cosine similarity. Swapping synonyms inside an unchanged sentence frame still yields
a cosine of roughly 0.95 against the original, which is above every flag threshold.

To move the embedding, change the information topology:

- **Reorder propositions** inside a paragraph. Positional encoding changes the
  self-attention pattern.
- **Change granularity.** Splitting one sentence in two, or fusing two into one,
  changes the pooling window over token vectors.
- **Insert a short original connecting statement.** This dilutes the weight of the
  original concepts in the pooled vector.

## 4. The AI detection layer: statistical style signals

AI detectors are statistical classifiers. No vendor publishes its model, but the signal
families are well established in the detection literature:

| Signal | Machine text | Human text | What changes it |
|---|---|---|---|
| Perplexity | Low, predictable choices | High, surprising choices | Less common but still correct word choices |
| Burstiness | Uniform sentence lengths and complexity | Wide variation in length and structure | Split some sentences, fuse others |
| Token probability | The obvious next token | Often a less obvious one | Rare-but-correct synonyms, domain vocabulary |
| Stylometric uniformity | Narrow length distribution, repeated markers, narrow vocabulary | Irregular distribution, varied markers | Voice mixing, clause movement, marker rotation |
| Entropy | Smooth, patterned sequences | Noisy, interrupted | Parentheticals, appositives, hedging |

**Non-native English bias.** Liang et al. (2023) showed that several prominent
detectors misclassify essays written by non-native English speakers as AI-generated,
with false-positive rates above 60 percent on TOEFL essays, because lower lexical
perplexity and more regular structure resemble machine output. Two consequences for
practice: a detector flag on academic work by a multilingual writer is not evidence of
AI use, and the style adjustments that help are the same ones that make prose read as
human rather than machine-like.

**What this layer rewards.** Genuinely varied rhythm, specific technical vocabulary, and
occasional asymmetry. It rewards prose that has a point of view, which is why the
structural layer matters more than any word list.

## 5. Transformation to signal mapping

Use this table to decide what to change when the audit points at a specific failure.

| Audit finding | Change that addresses it | Layer |
|---|---|---|
| Matched 5-gram chains | Phrase rewrite, then word substitution inside each chain | L1 |
| Matched chains near protected terms | Clause movement, so the chain is broken by reordering | L2 |
| Uniform sentence lengths | Split long sentences, fuse short adjacent ones | L2 |
| Repeated discourse markers | Marker rotation, no repeat within the document | L4 |
| Low lexical diversity | Rare-but-correct synonyms, domain-specific nouns | L1 |
| High-frequency trigger phrases | Direct replacement with a plain alternative | L1 |
| Zero-width characters | Purge the characters, do not paraphrase around them | tooling |
| Whole-paragraph clone | Proposition reordering, granularity shift, bridging sentence | L3 |
| Low compression entropy | Vary the vocabulary and the sentence rhythm, not the wording alone | L1 and L2 |

### Compression entropy

The audit's seventh section reports two numbers that describe how predictable the
prose is.

- **Entropy bits per character** is the Shannon entropy of the character
  distribution. English academic prose normally sits around 4.0 to 4.4 bits per
  character. Below about 3.6 the text repeats the same characters in a way that
  suggests templated output.
- **Compressed ratio** is the size of the gzipped text divided by the size of the
  raw text. Text that repeats the same words in the same order compresses well, so
  a low ratio points at predictable phrasing. Short documents compress more
  readily than long ones, so compare a document with itself over time rather than
  with another document.

This is a repeatability proxy, not a detector. Human writing can score low and
machine writing can score high. Treat a fall in these numbers as evidence that
the wording became more varied, never as proof that anything was detected or
cleared.

## 6. What does not work

- **Changing punctuation, capitalisation or spelling.** Normalisation removes all three
  before comparison.
- **Reordering words within a sentence without changing the words.** This does break
  the hash, but it produces broken grammar. Reorder complete clauses instead.
- **Synonym swapping alone.** It leaves the structural and semantic layers untouched,
  so a document can still read as a clone to those layers.
- **Replacing every word.** It destroys the technical precision that makes the text
  correct, and the result is easier to spot than the original.
- **Adding random typos or errors.** It does not affect a normalised comparison and it
  damages the work.
- **Rewriting the reference list.** It is excluded from the score and it breaks the
  citations.
- **Trusting any promised score.** Detectors change without notice and corpora shift.

## 7. References

- Schleimer, S., Wilkerson, D. S., and Aiken, A. (2003). Winnowing: Local algorithms for
  document fingerprinting. In Proceedings of SIGMOD, 409-420.
- Manku, G., Jain, A., and Das Sarma, A. (2007). Detecting near-duplicates for web
  crawling. In Proceedings of WWW, 141-150.
- Liang, W., Yuksekgonul, M., Mao, Y., Wu, E., and Zou, J. (2023). GPT detectors are
  biased against non-native English writers. Patterns, 14(2), 117-129.
- Broder, A. (1997). On the resemblance and containment of documents. In Proceedings of
  the Compression and Complexity of Sequences, 21-29.

---

*Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved. Licensed under the MIT Licence.*
