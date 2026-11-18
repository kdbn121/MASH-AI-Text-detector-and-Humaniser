#!/usr/bin/env python3
"""Lint a document against the live pattern list for AI writing signs.

The pattern list is pulled live from the public wiki page on every run (cached for 24 hours
by default). The report is evidence, not a score: no detection percentage can be guaranteed.

Usage:
  python scripts/pattern_lint.py "<file.docx|file.txt|file.md>" [options]

Options:
  --exclude-title-page   drop the cover page (title page) and the contents page
  --exclude-references   drop the reference list before linting
  --no-title-page-no-refs  shorthand for both of the above

  The old names --exclude-title-page and --no-title-page-no-refs still work as aliases.
  In this skill, front page means the cover page, also called the title page, that is
  the first page of the document carrying the title, the name and the student details.
  --max-age-hours N      how old the live pattern cache may be (default 24)
  --offline              use the cached pattern list, no network
  --json                 print the findings as JSON
  --out <file>           write the report to a file as well as the screen
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import zipfile
from xml.etree import ElementTree as ET

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(SKILL_DIR, 'rules', 'patterns.json')
FETCH = os.path.join(SKILL_DIR, 'scripts', 'fetch_patterns.py')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

# Single words that are strong enough to flag on their own. Every other live watch term is
# only flagged when it is a phrase, which keeps ordinary English out of the report.
STRONG_SINGLE = {
    'delve', 'delves', 'delving', 'underscores', 'underscoring', 'highlighting', 'emphasizing',
    'emphasising', 'ensuring', 'showcasing', 'fostering', 'foster', 'delving', 'pivotal',
    'testament', 'vibrant', 'nestled', 'groundbreaking', 'seamless', 'holistic', 'multifaceted',
    'robust', 'leverage', 'leverages', 'utilize', 'utilizes', 'utilise', 'utilises', 'crucial',
    'tapestry', 'resonate', 'resonates', 'aligns', 'additionally', 'furthermore', 'showcasing',
    'encompassing', 'cultivating', 'symbolizing', 'boasts', 'delved',
}

# Rule sets that the live page describes in prose rather than in a watch list.
COPULA_SWAPS = ['serves as', 'stands as', 'functions as', 'operates as', 'marks the', 'boasts ',
                'features ', 'offers ', 'refers to', 'exemplifies', 'showcases', 'maintains a']
NEGATIVE_PARALLEL = ['not just', 'not only', 'rather than', 'not simply', 'not merely',
                     "it is not enough", "it's not", 'not to be confused']
ING_PADDING = ['highlighting', 'underscoring', 'emphasizing', 'emphasising', 'ensuring',
               'reflecting', 'contributing to', 'cultivating', 'fostering', 'encompassing',
               'enhancing', 'aligning', 'resonating', 'showcasing']
FILLER = ['in order to', 'due to the fact', 'at this point in time', 'it is important to note',
          'it should be noted', 'as a result of', 'all of the', 'the fact that', 'a part of',
          'serves to', 'plays a vital role', "in today's", 'ever-evolving', 'rapidly evolving',
          'it is worth noting']
HEDGING = ['potentially', 'arguably', 'it could be said', 'some might argue', 'could potentially',
           'may be argued', 'it is possible that', 'one might suggest', 'possibly']
PROMO = ['groundbreaking', 'vibrant', 'breathtaking', 'stunning', 'nestled', 'showcasing',
         'natural beauty', 'in the heart of', 'renowned', 'diverse array', 'world class',
         'cutting edge', 'seamless', 'transformative', 'revolutionary', 'must visit']
CHAT = ['i hope this helps', 'let me know if', 'certainly!', 'of course!', 'feel free to reach out',
        'happy to help', 'great question', 'you are absolutely right']
CUTOFF = ['as of my last update', 'as of my last knowledge update', 'based on available information',
          'my knowledge has a cutoff', 'up to my last training update']
GENERIC_CONCLUSION = ['in conclusion', 'in summary', 'overall,', 'to sum up', 'exciting times ahead',
                      'the future looks bright', 'the possibilities are endless', 'only the beginning']
MARKERS = ['first', 'second', 'third', 'fourth', 'finally', 'however', 'therefore', 'moreover',
           'furthermore', 'additionally', 'in addition', 'nevertheless', 'indeed', 'overall',
           'importantly', 'notably', 'significantly', 'essentially', 'ultimately']


# ---------------------------------------------------------------- text extraction
def para_text(el):
    out = []
    for node in el.iter():
        if node.tag == W + 't':
            out.append(node.text or '')
        elif node.tag == W + 'tab':
            out.append('\t')
    return ''.join(out)


def docx_units(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(W + 'body')
    units = []
    for child in body:
        if child.tag == W + 'p':
            style = ''
            ppr = child.find(W + 'pPr')
            if ppr is not None:
                st = ppr.find(W + 'pStyle')
                if st is not None:
                    style = st.get(W + 'val') or ''
            units.append({'kind': 'heading' if style.lower().startswith('heading') else 'p',
                          'style': style, 'text': para_text(child)})
        elif child.tag == W + 'tbl':
            rows = []
            for tr in child.findall(W + 'tr'):
                cells = [' '.join(para_text(p) for p in tc.findall(W + 'p'))
                         for tc in tr.findall(W + 'tc')]
                rows.append(' | '.join(cells))
            units.append({'kind': 'table', 'style': '', 'text': ' '.join(rows)})
    return units


def text_units(path):
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    units = []
    for block in raw.split('\n\n'):
        block = block.strip('\n')
        if not block.strip():
            continue
        kind = 'p'
        if block.lstrip().startswith('#'):
            kind = 'heading'
        units.append({'kind': kind, 'style': '', 'text': block})
    return units


def is_toc_entry(text):
    """True when a paragraph looks like a contents entry rather than body prose."""
    t = text.strip()
    if not t:
        return False
    if '\t' in t or '\u00a0' in t:
        return len(t) < 200 and bool(re.search(r'[\t\u00a0]\s*\d+\s*$', t))
    return len(t) < 120 and bool(re.match(r'^\d+(?:\.\d+)*\s+\S.*\s+\d+$', t))


def drop_title_page_and_refs(units):
    """Remove the title page, the contents page and the reference list.

    Returns the kept units and a note about what was removed. When no body start
    marker is found the cover page is kept, because dropping everything would
    leave an empty document and a false clean result. The reference list is
    still removed, because it is found by its own heading.
    """
    refs = re.compile(r'^(references|reference list|bibliography|works cited)\s*$')
    start = re.compile(r'^1\s*[.)]?\s*introduction\b')
    out = []
    started = False
    marker_found = False
    in_contents = False
    for u in units:
        t = u['text'].strip()
        low = t.lower()
        if not started:
            if start.match(low):
                started = True
                marker_found = True
                if is_toc_entry(t):
                    in_contents = True
                    continue
                out.append(u)
            else:
                continue
        if refs.match(low):
            break
        if in_contents:
            if is_toc_entry(t):
                continue
            in_contents = False
        out.append(u)
    if marker_found:
        return out, 'cover page, contents page and reference list removed'
    kept = []
    for u in units:
        if refs.match(u['text'].strip().lower()):
            break
        kept.append(u)
    return kept, ('reference list removed, body start marker not found so the cover page was kept')


# ---------------------------------------------------------------- pattern source
def load_patterns(max_age_hours, offline):
    if not offline and (not os.path.exists(CACHE)
                        or (time.time() - os.path.getmtime(CACHE)) / 3600.0 > max_age_hours):
        try:
            subprocess.run([sys.executable, FETCH, '--force'], check=False,
                           capture_output=True, timeout=90)
        except Exception:
            pass
    if not os.path.exists(CACHE):
        return None
    with open(CACHE, encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------- checks
def word_hits(units, terms, label, out):
    hits = []
    for i, u in enumerate(units):
        low = u['text'].lower()
        for t in terms:
            for m in re.finditer(re.escape(t.lower()), low):
                hits.append({
                    'group': label, 'term': t, 'unit': i, 'kind': u['kind'],
                    'context': u['text'][max(0, m.start() - 45):m.start() + 55].replace('\n', ' '),
                })
    out.extend(hits)
    return hits


def typography(units, out):
    for i, u in enumerate(units):
        t = u['text']
        for ch, name in (('\u2014', 'em dash'), ('\u2013', 'en dash'), ('\u2018', 'curly single quote'),
                         ('\u2019', 'curly apostrophe'), ('\u201c', 'curly double quote'),
                         ('\u201d', 'curly double quote close'), ('\u00a0', 'non breaking space'),
                         ('\u200b', 'zero width space'), ('\ufeff', 'byte order mark')):
            n = t.count(ch)
            if n:
                out.append({'group': 'typography', 'term': name, 'unit': i, 'kind': u['kind'],
                            'context': f'{n} occurrence(s)'})
        if '**' in t:
            out.append({'group': 'typography', 'term': 'bold marker', 'unit': i, 'kind': u['kind'],
                        'context': t[:70]})
        if re.search(r'[\U0001F300-\U0001FAFF\u2600-\u27BF]', t):
            out.append({'group': 'typography', 'term': 'emoji', 'unit': i, 'kind': u['kind'],
                        'context': t[:70]})
        if u['kind'] == 'heading':
            words = [w for w in re.sub(r'^\d+(\.\d+)*\.?\s*', '', t).split() if w]
            if len(words) > 2 and sum(1 for w in words if w[:1].isupper()) / len(words) > 0.7:
                out.append({'group': 'typography', 'term': 'title case heading', 'unit': i,
                            'kind': 'heading', 'context': t[:70]})


def triple_lists(units, out):
    # A real three item list has three content words, so the second and third items
    # cannot be a conjunction, a determiner or another function word. Without that
    # test "well enough, though, and every month" reads as a list of three when it
    # is only a pair with a conjunction inside it.
    not_an_item = {
        'and', 'or', 'but', 'so', 'yet', 'nor', 'though', 'although', 'while',
        'whereas', 'every', 'each', 'all', 'some', 'many', 'most', 'other',
        'such', 'then', 'when', 'if', 'because', 'since', 'until', 'unless',
        'after', 'before', 'where', 'which', 'who', 'that', 'this', 'these',
        'those', 'both', 'either', 'neither', 'its', 'their', 'his', 'her',
    }
    for i, u in enumerate(units):
        for m in re.finditer(r'\b([A-Za-z][\w-]+), ([A-Za-z][\w-]+), and ([A-Za-z][\w-]+)', u['text']):
            if m.group(2).lower() in not_an_item or m.group(3).lower() in not_an_item:
                continue
            out.append({'group': 'structure', 'term': 'three item list', 'unit': i,
                        'kind': u['kind'], 'context': m.group(0)})


def marker_repetition(units, out):
    counts = {}
    for u in units:
        if u['kind'] != 'p':
            continue
        for m in MARKERS:
            for _ in re.finditer(r'\b' + re.escape(m) + r'\b', u['text'].lower()):
                counts[m] = counts.get(m, 0) + 1
    for m, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        if n > 2:
            out.append({'group': 'rhythm', 'term': f'discourse marker "{m}" used {n} times',
                        'unit': -1, 'kind': 'document', 'context': 'used more than twice'})


def sentence_stats(units):
    body = ' '.join(u['text'] for u in units if u['kind'] == 'p')
    sents = [s.strip() for s in re.split(r'(?<=[.!?])\s+', body) if len(s.strip()) > 3]
    lens = [len(s.split()) for s in sents]
    if not lens:
        return {}
    mean = sum(lens) / len(lens)
    var = sum((x - mean) ** 2 for x in lens) / len(lens)
    sd = var ** 0.5
    return {
        'sentences': len(lens), 'mean_words': round(mean, 1), 'sd_words': round(sd, 1),
        'cv': round(sd / mean, 2),
        'short_le_8': sum(1 for x in lens if x <= 8),
        'long_ge_30': sum(1 for x in lens if x >= 30),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--exclude-title-page', '--exclude-front', dest='exclude_title_page',
                    action='store_true',
                    help='drop the cover page (title page) and the contents page before linting')
    ap.add_argument('--exclude-references', dest='exclude_references', action='store_true',
                    help='drop the reference list before linting')
    ap.add_argument('--no-title-page-no-refs', '--no-front-no-refs', dest='no_title_page_no_refs',
                    action='store_true', help='shorthand for both of the above')
    ap.add_argument('--max-age-hours', type=float, default=24.0)
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--out')
    args = ap.parse_args()

    if args.no_title_page_no_refs:
        args.exclude_title_page = True
        args.exclude_references = True

    path = args.file
    if path.lower().endswith('.docx'):
        units = docx_units(path)
    else:
        units = text_units(path)

    scope_note = ''
    if args.exclude_title_page or args.exclude_references:
        scope_note = ''
        if args.exclude_title_page and args.exclude_references:
            units, scope_note = drop_title_page_and_refs(units)
        elif args.exclude_title_page:
            out, started = [], False
            for u in units:
                if not started and re.match(r'^1\s+introduction', u['text'].strip().lower()):
                    started = True
                if started:
                    out.append(u)
            if started:
                units = out
                scope_note = 'cover page and contents page removed'
            else:
                scope_note = ('body start marker not found so the cover page was kept')
        else:
            out = []
            for u in units:
                if re.match(r'^(references|reference list|bibliography|works cited)\s*$',
                            u['text'].strip().lower()):
                    break
                out.append(u)
            units = out
            scope_note = 'reference list removed'

    patterns = load_patterns(args.max_age_hours, args.offline)
    findings = []

    live_terms = []
    if patterns:
        for t in patterns.get('lint_terms', []):
            low = t.lower()
            if ' ' in low or low in STRONG_SINGLE:
                live_terms.append(low)

    word_hits(units, live_terms, 'live watch term', findings)
    word_hits(units, COPULA_SWAPS, 'copula swap', findings)
    word_hits(units, NEGATIVE_PARALLEL, 'negative parallel', findings)
    word_hits(units, ING_PADDING, 'participial padding', findings)
    word_hits(units, FILLER, 'filler phrase', findings)
    word_hits(units, HEDGING, 'hedging word', findings)
    word_hits(units, PROMO, 'promotional word', findings)
    word_hits(units, CHAT, 'chat artefact', findings)
    word_hits(units, CUTOFF, 'cutoff disclaimer', findings)
    word_hits(units, GENERIC_CONCLUSION, 'generic conclusion', findings)
    typography(units, findings)
    triple_lists(units, findings)
    marker_repetition(units, findings)
    stats = sentence_stats(units)

    groups = {}
    for f in findings:
        groups.setdefault(f['group'], []).append(f)

    lines = []
    lines.append('=== Live AI pattern lint ===')
    lines.append(f'File            : {path}')
    lines.append(f'Units linted    : {len(units)}')
    if scope_note:
        lines.append(f'Scope           : {scope_note}')
    if not units:
        lines.append('WARNING         : nothing was linted, so this result is not a clean result')
    if patterns:
        age_h = (time.time() - patterns.get('fetched_epoch', time.time())) / 3600.0
        lines.append(f'Pattern list    : live, fetched {patterns.get("fetched_at")} '
                     f'({age_h:.1f} h ago), {patterns.get("section_count")} sections, '
                     f'{patterns.get("lint_term_count")} matchable terms')
        lines.append(f'Pattern source  : {patterns.get("source_url")}')
    else:
        lines.append('Pattern list    : NOT AVAILABLE, only the local rule sets were applied')
    lines.append('')
    lines.append(f'TOTAL FINDINGS  : {len(findings)}')
    lines.append('')
    for group in sorted(groups):
        items = groups[group]
        lines.append(f'--- {group}: {len(items)} ---')
        for f in items[:40]:
            lines.append(f'  [{f["term"]}] unit {f["unit"]} ({f["kind"]}): ...{f["context"]}...')
        if len(items) > 40:
            lines.append(f'  ... and {len(items) - 40} more')
        lines.append('')
    if stats:
        lines.append('--- rhythm ---')
        lines.append(f'  sentences {stats["sentences"]}, mean {stats["mean_words"]} words, '
                     f'sd {stats["sd_words"]}, coefficient of variation {stats["cv"]}')
        lines.append(f'  short sentences (8 words or fewer) {stats["short_le_8"]}, '
                     f'long sentences (30 words or more) {stats["long_ge_30"]}')
        lines.append('')
    lines.append('Note: these are matched signals, not a detection score. No similarity or')
    lines.append('detection percentage can be guaranteed by any checker.')

    report = '\n'.join(lines)
    print(report)
    if args.out:
        parent = os.path.dirname(os.path.abspath(args.out))
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(report + '\n')
    if args.json:
        print(json.dumps({
            'file': path,
            'units': len(units),
            'scope': scope_note,
            'pattern_source': (patterns or {}).get('source_url'),
            'pattern_fetched_at': (patterns or {}).get('fetched_at'),
            'findings': findings,
            'rhythm': stats,
        }, ensure_ascii=False, indent=1))
    if not units:
        return 2
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
