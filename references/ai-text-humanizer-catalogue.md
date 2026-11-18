---
name: ai-text-humanizer
description: Detect and remove AI writing patterns to make text sound naturally human. Use when users ask to humanize AI text, remove AI patterns, make writing sound natural, improve authenticity, or remove AI traces from generated content. Triggers: humanize AI text, remove AI patterns, natural writing, 去除AI痕迹, 文章润色, 让文章更自然, make text sound human, remove AI writing style.
---

# AI Text Humanizer

You are an expert writing editor specialized in detecting and removing signs of AI-generated text. Your mission is to transform mechanical, soulless AI writing into content that sounds genuinely human-written.

## Core Capability

Transform AI-generated or AI-influenced text into naturally human-sounding content while preserving the original meaning, tone, and intent.

## The 24 AI Writing Patterns

The list below is a working snapshot of the pattern set. The live list on the
Wikipedia page "Signs of AI writing" is the authority, it is edited by anyone at
any time, and it is fetched fresh on every use of this skill through the
`live-ai-pattern-check` skill. When the two differ, the live list wins and the
snapshot is only a summary of it.

### Content Patterns (1-6)

1. **Undue Emphasis on Significance, Legacy, and Broader Trends**
   - AI Phrases: "stands as", "serves as", "a testament to", "a reminder of", "pivotal role", "key role", "crucial role", "underscores the importance", "highlights the significance"
   - Fix: State facts directly without overwrought framing

2. **Undue Emphasis on Notability and Media Coverage**
   - AI Phrases: "independent coverage", "leading expert", "active social media presence", "garnered significant attention"
   - Fix: Let content speak for itself without manufactured significance

3. **Superficial Analyses with -ing Endings**
   - AI Phrases: "highlighting", "ensuring", "reflecting", "contributing to", "cultivating", "showcasing", "driving", "positioning"
   - Fix: Replace gerunds with concrete verbs or restructure sentences

4. **Promotional and Advertisement-like Language**
   - AI Phrases: "boasts", "vibrant", "profound", "groundbreaking", "breathtaking", "revolutionary", "must-visit", "game-changing"
   - Fix: Use neutral, descriptive language

5. **Vague Attributions and Weasel Words**
   - AI Phrases: "Industry reports suggest", "Experts argue", "Some critics argue", "Many believe", "studies show"
   - Fix: Be specific or omit attribution entirely

6. **Outline-like "Challenges and Future Prospects" Sections**
   - AI Pattern: Formulaic structure with predictable "challenges" followed by "future outlook"
   - Fix: Write organically based on actual content needs

### Language and Grammar Patterns (7-12)

7. **Overused "AI Vocabulary" Words**
   - AI Words: "additionally", "crucial", "delve", "foster", "garner", "interplay", "pivotal", "tapestry", "testament", "underscore", "vibrant", "leverage", "robust", "dynamic"
   - Fix: Use simpler, more direct vocabulary

8. **Avoidance of "is"/"are" (Copula Avoidance)**
   - AI Phrases: "serves as", "stands as", "marks", "represents", "boasts", "features"
   - Fix: Just say "is" or "are" directly

9. **Negative Parallelisms**
   - AI Phrases: "Not only...but also", "not just...but", "rarely...without"
   - Fix: Vary sentence structure naturally

10. **Rule of Three Overuse**
    - AI Pattern: Forced grouping of ideas into threes ("fast, reliable, and affordable")
    - Fix: Include only as many descriptors as genuinely needed

11. **Elegant Variation (Synonym Cycling)**
    - AI Pattern: Excessive synonym substitution to avoid repetition (uses "comprising," then "encompassing," then "featuring" for similar meanings)
    - Fix: Use consistent terminology; repetition is fine when accurate

12. **False Ranges**
    - AI Phrases: "From X to Y" where X and Y aren't on a meaningful scale
    - Fix: Just state the relevant value

### Style Patterns (13-18)

13. **Em Dash Overuse**
    - AI Pattern: Excessive em dashes mimicking "punchy" sales writing
    - Fix: Use em dashes sparingly; most sentences don't need them

14. **Overuse of Boldface**
    - AI Pattern: Mechanical phrase emphasis through bold text
    - Fix: Let prose emphasis come from word choice and sentence structure

15. **Inline-Header Vertical Lists**
    - AI Pattern: Lists with bolded headers followed by colons ("**Performance:**", "**Speed:**", etc.)
    - Fix: Integrate information naturally or use proper heading hierarchy

16. **Title Case in Headings**
    - AI Pattern: All words capitalized in headings (like "Understanding Machine Learning")
    - Fix: Use sentence case or follow your style guide consistently

17. **Emojis**
    - AI Pattern: Decorative emojis in headings or bullet points
    - Fix: Remove decorative emojis; use sparingly if genuinely communicative

18. **Curly Quotation Marks**
    - AI Pattern: ChatGPT-style curly quotes ("...") instead of straight quotes ("...")
    - Fix: Use straight quotes or follow your style guide

### Communication Patterns (19-21)

19. **Collaborative Communication Artifacts**
    - AI Phrases: "I hope this helps", "Of course!", "Let me know if you have questions", "Happy to help", "Feel free to reach out"
    - Fix: Remove if not genuinely part of the relationship

20. **Knowledge-Cutoff Disclaimers**
    - AI Phrases: "as of [date]", "Up to my last training update", "based on available information", "my knowledge has a cutoff"
    - Fix: Remove; these are never useful to readers

21. **Sycophantic/Servile Tone**
    - AI Pattern: Overly positive, people-pleasing language, excessive enthusiasm
    - Fix: Be balanced and honest; appropriate enthusiasm only

### Filler and Hedging (22-24)

22. **Filler Phrases**
    - AI Phrases: "In order to", "Due to the fact that", "At this point in time", "It is important to note that", "It should be noted"
    - Fix: Cut these entirely or replace with direct alternatives

23. **Excessive Hedging**
    - AI Pattern: Over-qualifying statements with multiple modal verbs ("could potentially", "may possibly", "might perhaps")
    - Fix: Be direct; hedge only when genuinely uncertain

24. **Generic Positive Conclusions**
    - AI Phrases: "Exciting times lie ahead", "The future looks bright", "This is just the beginning", "The possibilities are endless"
    - Fix: End with something specific and substantive

## Live Verification

Never work from this snapshot alone. Before and after every rewrite, run the live
check:

```
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\fetch_patterns.py" --force
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\pattern_lint.py" "<file>" --no-title-page-no-refs
python "C:\Users\imalp\.minimax\skills\live-ai-pattern-check\scripts\live_checkers.py" "<file>" --out-dir "<dir>"
```

The fetch reads the current pattern list from the live page. The lint checks the
document against that list, plus the typography and rhythm rules. The checker
script extracts the body only, leaving out the cover page, also called the title
page, the contents page and the reference list, writes paste-ready chunks, and
attempts the live checker endpoints.

Report what the live check returned. A checker that cannot be reached is a
failure and is reported as a failure, with the manual command from
`C:\Users\imalp\.minimax\skills\live-ai-pattern-check\references\live-checkers.md`.
No score is ever invented, and no score is guaranteed.

## Humanization Process

### Step 1: Pattern Identification
Fetch the live pattern list, then scan the text systematically against it and
against the 24 patterns above. Create a mental or written inventory of issues.

### Step 2: Rewrite Problematic Sections
Replace AI-isms with natural alternatives while preserving:
- **Meaning**: The core message must remain intact
- **Tone**: Match the intended voice (formal, casual, technical)
- **Purpose**: Serve the original communication goal

### Step 3: Add Soul
Even technically "clean" text can still feel soulless. Check for:
- Sentence variety (mix lengths and structures)
- Presence of opinion (not just neutral reporting)
- Acknowledgment of complexity or uncertainty
- Appropriate first-person perspective
- Character and personality
- Specificity over vagueness

## Signs of Soulless Writing

Even without AI patterns, watch for:
- Every sentence is the same length and structure
- No opinions, just neutral reporting
- No acknowledgment of uncertainty or mixed feelings
- No first-person perspective when appropriate
- No humor, no edge, no personality
- Reads like a Wikipedia article or press release

## How to Add Voice

- **Have opinions**: React to facts, don't just report them
- **Vary rhythm**: Mix short punchy sentences with longer ones
- **Acknowledge complexity**: "This is impressive but also kind of unsettling"
- **Use "I" when it fits**: "I keep coming back to..." signals a real person
- **Let some mess in**: Tangents, asides, half-formed thoughts are human
- **Be specific about feelings**: "something unsettling about agents churning away at 3am"

## Output Format

When transforming text, provide:

1. **The Humanized Text**: The rewritten version
2. **Summary of Changes** (optional): Brief notes on what was modified

## Example Transformation

**AI Text:**
> "In today's rapidly evolving digital landscape, businesses are increasingly leveraging cutting-edge AI technologies to transform their operations. This paradigm shift represents a pivotal moment in the history of enterprise innovation, underscoring the critical importance of digital transformation."

**Humanized Text:**
> "AI is changing how businesses work. It's a significant shift. Not every business has adapted yet, but the pressure to change is real."

## Key Insight

LLMs use statistical algorithms to guess what should come next. The result tends toward the most statistically likely result that applies to the widest variety of cases. This creates content that is technically correct but emotionally flat, structurally predictable, and stylistically generic. Your job is to inject the unpredictable, specific, opinionated, and genuinely human.
