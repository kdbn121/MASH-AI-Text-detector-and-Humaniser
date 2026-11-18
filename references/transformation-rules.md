# Transformation rules

Rule banks for the transformation ladder. Apply in order: L1 lexical, L2 structural,
L3 semantic, L4 discourse. Each stage assumes the previous one has run.

Two rules govern everything below:

1. **The marker test.** Every rewritten sentence must be one the author would defend in
   a viva. A rare word is not a virtue in itself; if the rare version would make a
   marker wince, use the common one. Rarity is a tiebreaker between acceptable
   options, never a reason to leave the acceptable option.
2. **The meaning test.** The claim, the strength of the claim and the strength of any
   hedge stay exactly as written. "may indicate" never becomes "proves"; "a modest
   improvement" never becomes "a substantial improvement". Heavy substitution is where
   meaning drifts, and drift is worse than a similarity score.

---

## The deterministic engine

`scripts/transform.mjs` runs these rules for you. It is a pre-pass, not a replacement
for reading the result. Every stage below is also available by hand from this file.

### Stage order

| # | Stage | What it does | Fires at |
|---|---|---|---|
| 1 | Phrase rewrites | multi-word academic phrasing replaced by a fixed alternative | 100 percent where applicable |
| 2 | Stock word swaps | a word a model reaches for swapped for a plainer word with the same meaning | 100 percent where applicable |
| 3 | Synonym substitution | content word swapped, inflected to match the original form | 70 percent |
| 4 | Determiner cycling | quantifier swapped for a grammatical alternative | 40 percent |
| 5 | Clause reordering | fronted prepositional phrase moved to the end | 20 percent |
| 6 | Voice transformation | passive to active, active to passive, or subject to object | 30 percent |
| 7 | Split and fusion | long sentence split, or two short sentences fused | 25 percent |
| 8 | Transition injection | category-matched connective added at a sentence start | 25 percent |
| 9 | Discourse rotation | over-used marker replaced with an equivalent | 50 percent |
| 10 | Hedge insertion | qualifier inserted at one clause boundary per paragraph | 20 percent |
| 11 | De-nominalisation | "the analysis of X" turned back into a verb phrase | 20 percent |
| 12 | Appositive insertion | gloss inserted after a defined term | 35 percent |
| 13 | Cadence repair | a flat paragraph measured and repaired | when flat |
| 14 | Opener variation | a trailing subordinate clause moved to the front | 70 percent |
| 15 | Document rhythm | a repeated opening changed across the document | when repeated |
| 16 | Chain breaking | matched runs measured against the source and broken | until clear |

The effective rate is scaled by a non-linear curve, so the top end bites harder than
the midpoint: `k = (level / 100) ** 0.75`. Standard is 70, which gives an effective
77 percent. The curve exists because the difference between 70 and 90 percent of
applied edits is much larger than the linear difference suggests.

### Masking

Before stage 1, the engine masks everything that must not move: LaTeX commands,
math, URLs, email addresses, DOIs, quoted strings, citation brackets, numbers with
units, decimals, bare numbers and every term in `rules/protected_terms.json`. The
mask is restored after stage 16, so no stage can alter a number or a citation.

### The chain breaker

Stage 16 is the one that matters for similarity. It measures the output against the
source using the same tokeniser as the audit, finds maximal runs of identical words,
and breaks them. It repeats until no run of eight words or more survives, because
one break only halves a run.

Four strategies are tried in order, and the first that applies wins:

1. **Phrase replacement.** A phrase from `rules/phrases.json` that covers the token
   is replaced. This is the highest quality break because it changes several words
   at once in a way a reader would accept.
2. **Connective expansion.** "but" becomes "but also", "and" becomes "as well as",
   "or" becomes "or alternatively", "itself" becomes "in itself". This is the only
   strategy that can break a run made entirely of function words.
3. **Synonym swap.** The token is replaced with a synonym inflected to match its
   grammatical form. The part of speech of the surrounding context decides which
   pool is used, so "support" as a noun becomes "backing" and "support" as a verb
   becomes "corroborate".
4. **Determiner swap.** A quantifier is replaced with an alternative.

### Inflection

`scripts/lib-inflect.mjs` keeps a replacement in the grammatical form of the word it
replaces. It covers plural, third person singular, past tense, participle, gerund and
adverb, handles irregular verbs, regular spelling rules, consonant doubling, and the
Latin plural forms such as "analysis" to "analyses". This is what stops the engine
producing "the results analyses show".

### Word banks

The banks live in `rules/` as plain JSON, so a user can extend them for their own
discipline without touching any code. Every bank carries a `_copyright` key so the
KDBN mark travels with the data. A bank whose data is a list stores it under
`items`.

**No bank may produce a phrase that the audit flags as a machine marker.** The
audit counts a trigger phrase when the phrase appears in the text, so a
replacement that contains one of those phrases would make the engine work against
itself: it would lower the similarity and raise the machine signal. The selftest
checks every bank against the audit's phrase list and fails if one collides.

| File | Shape | Purpose |
|---|---|---|
| `phrases.json` | `items` list of `[original, replacement]` | multi-word rewrites |
| `synonyms.json` | object, lemma to array or to `{noun, verb, adj, adverb}` pools | content word swaps |
| `determiners.json` | object, determiner to array | quantifier swaps |
| `transitions.json` | object, category to array | sentence-initial connectives |
| `discourse.json` | object, marker to array | discourse marker rotation |
| `hedges.json` | `items` list | qualifier register |
| `protected_terms.json` | `items` list | terms that must never change |
| `nominalisations.json` | object, noun to gerund | de-nominalisation |
| `appositives.json` | object, term to gloss | appositive insertion |

A synonym entry may be a flat array, which is used in any context, or an object with
`noun`, `verb`, `adj` and `adverb` pools. An entry with several pools is only used
when the engine can work out the part of speech from the surrounding words. A
multi-word replacement is only allowed inside a `noun` pool, because a multi-word
replacement cannot be inflected.

### What the engine will not do

- It will not rewrite a paragraph whose runs carry different formatting, because
  replacing the text would flatten the styling. Such paragraphs are listed as
  skipped in the transform report.
- It will not rewrite a paragraph inside a table, because the rewrite script
  refuses to change table XML.
- It will not touch a heading.
- It will not swap a word that sits in a fixed relative construction such as "the
  extent to which", because the collocation would break.
- It will not inflect a phrase replacement. The rule author supplies the
  replacement in its correct form.

---

## L1a. Multi-word phrase rewrites

A three-word phrase rewrite breaks roughly five overlapping 5-gram windows, so this is
the highest-value single edit in the whole ladder. Apply wherever the phrase appears
and the meaning is preserved.

### Literature review
| Original | Rewrite |
|---|---|
| previous studies have shown that | earlier work has established that |
| has been widely studied | has attracted sustained scholarly attention |
| it has been reported that | the published record indicates that |
| according to recent research | contemporary scholarship indicates that |
| is well documented | is amply documented in the literature |
| as mentioned earlier | as noted in the preceding section |
| the existing literature | the prevailing body of scholarship |
| a large body of work | an extensive literature |
| little attention has been paid to | has received comparatively little scrutiny |
| has been the subject of much debate | has been much debated |
| a well-established field | a long-established field |

### Methodology
| Original | Rewrite |
|---|---|
| was carried out | was undertaken |
| in order to | with the aim of |
| by means of | through |
| with respect to | in relation to |
| takes into account | gives due weight to |
| is based on | draws on |
| data were collected | data were gathered |
| a sample of | a selection of |
| in the case of | for |
| due to the fact that | because |
| a variety of factors | several factors |
| prior to | before |
| subsequent to | after |
| is dependent on | hinges on |

### Results and findings
| Original | Rewrite |
|---|---|
| the results indicate | the findings suggest |
| it can be seen that | it emerges that |
| as shown in | as illustrated in |
| it was found that | the analysis showed that |
| a marked increase | a marked rise |
| is proportional to | scales with |
| compared with | in relation to |
| on average | typically |
| the majority of cases | most cases |

### Discussion and analysis
| Original | Rewrite |
|---|---|
| it is worth noting that | notably |
| this can be attributed to | this is traceable to |
| plays a crucial role | is central to |
| is consistent with | accords with |
| in agreement with | in concordance with |
| these findings suggest that | the evidence points to |
| a significant factor | a material factor |
| it is important to note that | delete, or open with the point itself |

### Conclusion
| Original | Rewrite |
|---|---|
| in conclusion | to conclude |
| further research is needed | further enquiry remains necessary |
| future work should | prospective work ought to |
| in summary | on balance |

### Hedging and quantification
| Original | Rewrite |
|---|---|
| it appears that | it would seem that |
| it is possible that | it may be the case that |
| to some extent | to a degree |
| a large number of | many |
| a wide range of | a broad spectrum of |
| as a result of | because of |

**Never rewrite these, whatever the pressure:**

- "significant" where it means statistically significant. Replace it only where it means
  "important" in the ordinary sense, and even then "material" or "marked" is safer.
- Any statistical value, p-value, test name, confidence level or effect size.
- Any term the author defined earlier in the document.
- Anything inside a direct quotation.

---

## L1b. Content-word synonyms

Use when a phrase rewrite cannot apply. Prefer a word that is less common but entirely
idiomatic in the discipline. Do not force a rare word where it would sound affected.

### Verbs
analyse -> examine, scrutinise, dissect | assess -> appraise, gauge, adjudicate
demonstrate -> illustrate, evidence, evince | investigate -> examine, explore, probe
determine -> ascertain, establish | calculate -> compute, quantify
compare -> contrast, juxtapose | explain -> account for, elucidate, expound
describe -> characterise, delineate | consider -> regard, conceive, reckon
show -> indicate, reveal, evidence | provide -> furnish, supply, afford
obtain -> acquire, procure, secure | use -> apply, employ
increase -> rise, grow, escalate | decrease -> decline, diminish
improve -> enhance, refine, sharpen | allow -> permit, enable, accommodate
require -> necessitate, demand | allow for -> accommodate, make provision for
support -> underpin, corroborate | suggest -> indicate, point to
reduce -> cut, lower, curtail | extend -> broaden, widen
establish -> establish, found | reveal -> disclose, expose

### Nouns
result -> outcome, finding, upshot | method -> approach, procedure, protocol
problem -> issue, difficulty, question | idea -> notion, concept, principle
change -> shift, alteration, modification | information -> data, evidence, material
amount -> quantity, volume, magnitude | part -> component, element, aspect
reason -> cause, basis, rationale | benefit -> advantage, gain, merit
difficulty -> limitation, obstacle, constraint | aim -> objective, purpose
approach -> framework, design, strategy | technique -> method, procedure
effect -> impact, consequence | issue -> matter, problem
aim of the study -> objective of the study | in the literature -> in the scholarship

### Adjectives and adverbs
important -> consequential, material, pivotal | relevant -> pertinent, germane, apposite
accurate -> precise, faithful, veridical | significant -> marked, appreciable (non-statistical only)
quickly -> rapidly, promptly | clearly -> evidently, unmistakably
often -> frequently, routinely | big -> substantial, considerable
small -> modest, marginal | good -> effective, sound
careful -> rigorous, meticulous | new -> recent, novel

### Avoid
"utilise" (a flagged construction), "leverage" as a verb, "a myriad of",
"plays a pivotal role", "delve into", "in today's world", "unlock the potential",
"navigate the complexities", "testament to", "tapestry", "underscore the importance",
"embark on", "elevate", "fostering" where "encouraging" is accurate.

---

## L1c. Determiner cycling

Determiners sit in nearly every sentence, so one swap breaks several windows. Cycle
rather than replace randomly, and keep the article "the" where it carries the meaning.

several -> numerous, a number of, multiple, various
many -> numerous, a considerable number of, myriad, plenty of
some -> certain, particular, select, assorted
few -> a limited number of, a scant handful of, sparse
most -> the majority of, the preponderance of, the greater part of
all -> every, each and every, the entirety of
each -> every, any given, every individual
both -> the two, each of the two, the pair of
another -> an additional, a further, one more
such -> said, the aforementioned, the given (only when "such" points back)
other -> alternative, additional, further, supplementary
various -> a range of, diverse, assorted
numerous -> many, a great many, plenty of
several factors -> a number of factors

Do not cycle determiners inside a technical definition, in a heading, or where the
phrase has become an established term.

---

## L1d. Hedge and qualifier register

Insert at most one hedge per paragraph. Over-hedging is itself a detector signal and
it weakens the argument.

arguably, plausibly, ostensibly, conceivably, purportedly, putatively, presumably,
tentatively, provisionally, appreciably, discernibly, measurably, tangibly, palpably,
manifestly, conspicuously, strikingly, decidedly, markedly, emphatically, unambiguously,
categorically, definitively, conclusively, verifiably, observably, evidently

Placement: after a comma, before the clause it qualifies. "The effect, though modest,
was consistent" not "The effect was though modest the consistent".

---

## L2a. Voice inversion

Active to passive changes the dependency tree, which changes the structural match.

We analysed the data -> The data were analysed
Researchers applied the method -> The method was applied by researchers
The model predicts the outcome -> The outcome is predicted by the model
This study examines the effect of X -> The effect of X is examined in this study
The results show a clear trend -> A clear trend is shown in the results
The framework supports learning -> Learning is supported by the framework

Rules: keep the passive for genuinely agentless or object-focused material; never
passive-voice the study's central claim, because passive voice moves the actor out of
view exactly where the reader needs it; keep the by-agent phrase when the actor matters.

## L2b. Clause split and sentence fusion

Split creates short sentences, fusion creates long ones. The contrast between them is
what produces human-looking rhythm.

Split:
"The model converges rapidly, and it requires few iterations." ->
"The model converges rapidly. It requires few iterations."
"The results indicate that X, which suggests that Y." ->
"The results indicate X. This suggests Y."
"Participants reported high satisfaction, and no adverse effects were noted." ->
"Participants reported high satisfaction. No adverse effects were noted."

Fuse, with connectors: which, and thereby, which in turn, so that, and consequently,
and as a result, and hence, along with
"The temperature increased. This caused expansion." ->
"The temperature increased, which consequently caused expansion."
"The method converges quickly. It requires fewer iterations." ->
"The method converges quickly, thereby requiring fewer iterations."
"The sample was small. The effect was unstable." ->
"The sample was small, and the effect was correspondingly unstable."

Fuse only adjacent sentences that share a subject or a logical link. Fusing two
unrelated statements produces a sentence that reads as a list.

## L2c. Clause movement

Move a complete modifier, never a fragment. Reordering the same words changes the hash
of every window that spans the moved region.

"Using the finite difference method, we solved the equation." ->
"We solved the equation using the finite difference method."
"For the purpose of validation, three test cases were selected." ->
"Three test cases were selected for the purpose of validation."
"In this chapter, we present the results." ->
"We present the results in this chapter."
"Despite the limitations, the method performs well." ->
"The method performs well despite the limitations."
"Following the pilot study, the main trial commenced." ->
"The main trial commenced following the pilot study."

## L2d. Nominalisation and de-nominalisation

Nominalisation changes part of speech, structure and word form at once, so a single
edit breaks several windows.

analyse -> analysis | assess -> assessment | implement -> implementation
evaluate -> evaluation | optimise -> optimisation | validate -> validation
demonstrate -> demonstration | establish -> establishment | observe -> observation
measure -> measurement | determine -> determination | classify -> classification
transform -> transformation | integrate -> integration | derive -> derivation
compute -> computation | simulate -> simulation | converge -> convergence
approximate -> approximation | solve -> solution | formulate -> formulation
apply -> application | develop -> development | improve -> improvement
reduce -> reduction | extend -> extension | modify -> modification
construct -> construction | compare -> comparison | investigate -> investigation
describe -> description | explore -> exploration | interpret -> interpretation

Verb to noun, with restructuring:
"We investigated the phenomenon." -> "An investigation of the phenomenon was conducted."
"The algorithm was implemented in Python." -> "Implementation of the algorithm was carried out in Python."

De-nominalise for variety:
"The application of the method." -> "Applying the method."
"The computation of eigenvalues." -> "Computing the eigenvalues."
"The implementation of the algorithm." -> "Implementing the algorithm."
"Evaluation of performance was performed." -> "Performance was evaluated."

## L2e. Appositive insertion

Insert at most once per term per document. The appositive carries information the
reader needs, so it is not padding.

finite difference method -> a discretisation technique for differential equations
boundary condition -> a constraint imposed on the solution domain
convergence -> the tendency of a sequence to approach a limiting value
stability -> the property that keeps error growth bounded
truncation error -> the discrepancy between the exact and the discrete operator
eigenvalue -> a characteristic scalar of a linear transformation
discretisation -> the conversion of a continuous model into a discrete form
initial condition -> the prescribed state at the starting time
explicit method -> a scheme that computes future states from known values
implicit method -> a scheme requiring simultaneous solution of coupled equations
numerical method -> a computational algorithm for approximate solutions
iterative process -> a repetitive procedure converging toward a solution
linear system -> a set of equations involving linear combinations
error analysis -> the systematic study of numerical inaccuracies
time step -> the discrete temporal increment in a marching scheme
grid spacing -> the distance between adjacent mesh nodes
wave equation -> a second-order partial differential equation governing oscillatory behaviour
heat equation -> a parabolic partial differential equation describing thermal diffusion
Laplace equation -> an elliptic partial differential equation characterising steady states
stochastic process -> a time-indexed collection of random variables
confidence interval -> a range of plausible values for an unknown population parameter
sample size -> the number of observations included in a study
covariance -> a measure of how two variables vary together
regression -> a statistical estimate of the relationship between variables
hypothesis -> a testable proposition about the relationship between variables
longitudinal study -> a study that follows the same participants over time
cross-sectional study -> a study that measures a population at a single point in time
qualitative method -> an approach that examines meaning rather than magnitude
quantitative method -> an approach that examines magnitude and frequency
validity -> the degree to which a measure captures what it is intended to capture
reliability -> the degree to which a measure yields consistent results
ethics approval -> the review and authorisation granted by a research ethics board
informed consent -> the documented agreement of a participant to take part
reflexivity -> the researcher's awareness of their own influence on the data
saturation -> the point at which further data collection adds nothing new
member checking -> the practice of returning findings to participants for verification
thematic analysis -> a method for identifying and coding patterns across qualitative data
triangulation -> the use of more than one method to corroborate a finding
coding -> the assignment of labels to segments of qualitative data
audit trail -> a record of the decisions made throughout a study
limitation -> a constraint on the scope or validity of a study

## L3. Semantic layer

**Proposition reordering.** Within a paragraph, move a self-contained proposition to a
different position. Logical connectives must be adjusted so the argument still reads in
order. Do not move a proposition that the following sentence depends on.

**Granularity shift.** Split one long sentence into two, or fuse two short ones. Use
the opposite of whatever L2b just did, so the document keeps a mixed rhythm rather than
settling into a new uniformity.

**Bridging sentence.** One short, original sentence between two technical statements.
It must add something real: a qualification, a reason, a scope condition. It must not
announce what is coming ("Now we turn to...").

## L4. Discourse marker rotation

Never reuse a rotation inside the same document. Repeating a marker is itself a signal.

however -> nevertheless, nonetheless, that said, on the other hand, be that as it may
therefore -> consequently, hence, as a result, it follows that, accordingly
moreover -> furthermore, in addition, additionally, beyond this, what is more
although -> even though, despite the fact that, notwithstanding, while it is true that
thus -> hence, accordingly, as such, in this way, by this means
indeed -> in fact, certainly, to be sure, without question
similarly -> likewise, comparably, in a similar way, by the same token
specifically -> in particular, more precisely, to be specific, namely
notably -> remarkably, importantly, strikingly, conspicuously
meanwhile -> in the interim, concurrently, at the same time, simultaneously
conversely -> on the contrary, in contrast, by contrast, contrastingly
ultimately -> in the final analysis, when all is considered, in the last analysis
evidently -> apparently, as it turns out, it appears that
essentially -> fundamentally, at its core, in essence
typically -> generally, ordinarily, as a rule, in most cases

Do not rotate markers inside a quotation, a heading, a numbered list, or where the
marker carries the logical weight of the sentence.

---

## Fire rates

Baseline rates at the Standard intensity level. Scale all of them together.

| Stage | Rate | Constraint |
|---|---|---|
| L1a phrase rewrite | 100 percent where applicable | never inside quotes or definitions |
| L1b synonym substitution | 70 percent | one content word per sentence at most |
| L1c determiner cycling | 40 percent | never in headings or definitions |
| L1d hedge insertion | 20 percent | at most one per paragraph |
| L2a voice inversion | 30 percent | sentences of 60 characters or more |
| L2b split and fusion | 25 percent | never split below 8 words |
| L2c clause movement | 20 percent | sentences of 80 characters or more |
| L2d nominalisation | 20 percent | sentences of 70 characters or more |
| L2e appositive | 35 percent | once per term per document |
| L3 proposition reordering | 30 percent | paragraph level, never across a section break |
| L3 granularity shift | 25 percent | opposite direction to the most recent split or fusion |
| L3 bridging sentence | 15 percent | must add real information |
| L4 marker rotation | 50 percent | no rotation reused in the document |

**Structural diversity rule.** Every sentence longer than 60 characters receives at
least two independent structural edits. One edit leaves the shape recognisable, and the
shape is what the structural matcher scores.

**Scatter rule.** Spread the edits through the document. Clustered edits leave long
untouched runs between them, and an untouched run of 8 words is still a match.

---

*Copyright (c) 2026 KDBN (Khaled Bhuiyan). All rights reserved. Licensed under the MIT Licence.*
