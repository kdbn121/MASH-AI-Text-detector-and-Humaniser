# Humanizer rules

The pattern catalogue with the fix for each entry, and the mechanics the detectors
actually read. This file restates the rules in plain language. The authoritative
source is the live page, and this skill fetches it on every run, so the catalogue
here is the working set rather than a frozen copy.

## The four groups

Content, language, style, communication. A rewrite that only handles one group
usually fails the check, because the detectors read all four.

## Content catalogue

| Pattern | What it looks like | The fix |
| --- | --- | --- |
| Inflated significance | serves as a testament to, pivotal moment in the evolution of | say what it is |
| Undue notability | featured in, widely covered by, leading expert | cite one source with a specific detail |
| -ing phrase padding | highlighting, underscoring, emphasizing, ensuring, reflecting | end the sentence, start a new one |
| Promotional language | vibrant, nestled, breathtaking, groundbreaking, seamless | plain, specific description |
| Vague attribution | experts say, industry observers note, studies show | name the source or drop the claim |
| Challenges and prospects | despite these challenges, the future looks bright | state the specific facts, cut the optimism |

## Language catalogue

| Pattern | What it looks like | The fix |
| --- | --- | --- |
| AI vocabulary | delve, crucial, landscape, tapestry, foster, leverage, utilise | normal words: look into, use, help |
| Copula avoidance | serves as, stands as, boasts, features, offers | say is or has |
| Negative parallelism | not just X, it is Y; not only X, but also Y | state the point directly |
| Rule of three abuse | innovation, inspiration and industry insights | do not force three; two or four is fine |
| Synonym cycling | the protagonist, the main character, the central figure | pick one name and keep it |
| False ranges | from X to Y where X and Y are not on one scale | list the topics |

## Style catalogue

| Pattern | What it looks like | The fix |
| --- | --- | --- |
| Em dash overuse | long dashes for dramatic effect | commas, periods or parentheses |
| Excessive bold | every other phrase in bold | bold sparingly or not at all |
| Inline header lists | bold label and colon inside a paragraph | prose, or real headings |
| Title case headings | Strategic Negotiations And Global Partnerships | sentence case |
| Emoji decoration | bullets starting with an emoji | remove them |
| Curly quotes and apostrophes | typographic quotation marks | straight quotes in plain text |

## Communication catalogue

| Pattern | What it looks like | The fix |
| --- | --- | --- |
| Chat artefacts | I hope this helps, let me know if, certainly | remove every pleasantry |
| Cutoff disclaimers | as of my last update, based on available information | state the facts directly |
| Sycophantic tone | great question, you are absolutely right | skip the validation, answer |
| Filler phrases | in order to, due to the fact that, at this point in time | cut them |
| Excessive hedging | could potentially possibly be argued that it might | pick a position |
| Generic conclusions | the future looks bright, exciting times ahead | end with a specific fact or next step |

## What the detectors measure

- Perplexity: how predictable the next word is. A model picks the most likely
  word each time, so the text stays close to the highest probability path. The
  fix is varied structure and ordinary word choices.
- Burstiness: humans write with uneven rhythm, a short sentence then a long one
  with an aside. A model keeps sentences near the same length. The fix is mixed
  rhythm.
- Vocabulary distribution: a small set of high frequency AI words appears far
  more often than in human writing. The fix is to replace them with plain ones.
- Transition smoothness: a model links sentences with a narrow set of
  connectors, over and over. The fix is to vary the linking, or to link nothing.

The detectors are private classifiers and their thresholds are not published. No
score can be guaranteed and none is invented here.

## Writing modes

When the target is an academic assignment, the register is formal but the machine
tells are still removed: no filler, no hedging stacks, no promotional language,
no vague attribution, real sources cited properly, no invented references. The
voice stays formal because the assignment requires it, and the detector signals
are removed because they are wrong in any register.

When the target is a general document, the same rules apply with the register
matched to the audience: contractions where they fit, shorter sentences, and no
effort to sound polished.

## Audit procedure

1. Fetch the live pattern list.
2. Lint the document and list every finding with the phrase that triggered it.
3. Rewrite each finding, keeping the meaning, the tone and the purpose intact.
4. Lint again. The second lint must return zero findings.
5. Run the live checkers and report what they actually said, including a failure
   when a checker cannot be reached.

A clean lint is not a certificate of human authorship. It means the known patterns
are absent.
