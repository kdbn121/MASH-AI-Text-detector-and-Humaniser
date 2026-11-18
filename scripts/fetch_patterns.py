#!/usr/bin/env python3
"""Live fetch of the public pattern list for AI writing signs, parsed into a machine usable cache.

The list is fetched from the live public wiki page on every run, so the rules never drift
from the source. A cached copy is kept only as an offline fallback, and the cache records
the exact revision it came from.

Usage:
  python scripts/fetch_patterns.py                 # fetch, refresh if older than 24 hours
  python scripts/fetch_patterns.py --force         # always refetch
  python scripts/fetch_patterns.py --offline       # use the cache, never touch the network
  python scripts/fetch_patterns.py --max-age-hours 6
  python scripts/fetch_patterns.py --json          # print the parsed summary
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(SKILL_DIR, 'rules', 'patterns.json')
SOURCE_URL = 'https://en.wikipedia.org/w/index.php?title=Wikipedia:Signs_of_AI_writing&action=raw'
PAGE_URL = 'https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0 Safari/537.36')


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode('utf-8', 'replace')


def split_words(blob):
    """Pull the comma separated watch terms out of a wiki strong/template run."""
    blob = blob.replace("''", '')
    blob = re.sub(r'<var>(.*?)</var>', r'\1', blob)
    blob = blob.replace('&nbsp;', ' ').replace('&amp;', '&')
    parts = re.split(r'[;,]\s*', blob)
    words = []
    for p in parts:
        p = p.strip().strip('|').strip()
        p = re.sub(r'\[\[([^\]|]+\|)?([^\]]+)\]\]', r'\2', p)
        p = re.sub(r'\{\{[^}]*\}\}', '', p).strip()
        p = re.sub(r'\[[^\]]*\]', '', p).strip()
        p = re.sub(r'\s+', ' ', p)
        if not p or len(p) > 70:
            continue
        words.append(p)
    return words


def lint_terms(terms):
    """Turn a watch list into clean terms that can be matched literally in a document."""
    out = []
    for t in terms:
        base = t.rstrip('. ').strip()
        if not base:
            continue
        if base.endswith('...'):
            base = base[:-3].strip()
        cands = [base]
        if '/' in base and len(base) <= 40:
            cands = [c.strip() for c in base.split('/') if c.strip()]
        for c in cands:
            c = c.strip(' .;')
            if len(c) < 3 or len(c) > 45:
                continue
            if c.lower() not in [x.lower() for x in out]:
                out.append(c)
    return out


def parse_wikitext(text):
    sections = []
    current = None
    for line in text.split('\n'):
        m = re.match(r'^\s*={2,4}\s*(.+?)\s*={2,4}\s*$', line)
        if m:
            current = {'name': m.group(1).strip(), 'shortcuts': [], 'watch_words': [], 'examples': []}
            sections.append(current)
            continue
        if current is None:
            continue
        for sc in re.findall(r'\{\{shortcut\|([^}]+)\}\}', line):
            for code in sc.split('|'):
                code = code.strip()
                if code and not code.lower().startswith('wp:') is False:
                    if code.upper().startswith('WP:'):
                        current['shortcuts'].append(code)
        for strong in re.findall(r'\{\{strong\|([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\}', line):
            for w in split_words(strong):
                if w not in current['watch_words']:
                    current['watch_words'].append(w)
        if 'Words to watch' in line:
            for strong in re.findall(r"\{\{strong\|(.*?)\}\}", line):
                for w in split_words(strong):
                    if w not in current['watch_words']:
                        current['watch_words'].append(w)
        if re.search(r"'''Examples'''", line):
            q = re.findall(r'\{\{quote frame\s*\|(.*?)\}\}\s*$', line)
            for item in q:
                item = re.sub(r'\{\{[^{}]*\}\}', ' ', item)
                item = re.sub(r'<[^>]+>', ' ', item)
                item = re.sub(r'\[\[([^\]|]+\|)?([^\]]+)\]\]', r'\2', item)
                item = ' '.join(item.split())
                if item:
                    current['examples'].append(item[:400])

    for s in sections:
        s['shortcuts'] = sorted(set(s['shortcuts']))
        s['lint_terms'] = lint_terms(s['watch_words'])

    all_words = []
    all_terms = []
    for s in sections:
        for w in s['watch_words']:
            if w.lower() not in [x.lower() for x in all_words]:
                all_words.append(w)
        for t in s['lint_terms']:
            if t.lower() not in [x.lower() for x in all_terms]:
                all_terms.append(t)

    return {
        'source_url': PAGE_URL,
        'raw_url': SOURCE_URL,
        'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'fetched_epoch': time.time(),
        'section_count': len(sections),
        'sections': sections,
        'watch_word_count': len(all_words),
        'watch_words': all_words,
        'lint_terms': all_terms,
        'lint_term_count': len(all_terms),
    }


def load_cache():
    if not os.path.exists(CACHE):
        return None
    with open(CACHE, encoding='utf-8') as f:
        return json.load(f)


def save_cache(data):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--max-age-hours', type=float, default=24.0)
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()

    cache = load_cache()
    age_hours = None
    if cache:
        age_hours = (time.time() - cache.get('fetched_epoch', 0)) / 3600.0

    if args.offline:
        if not cache:
            print('ERROR: no cached pattern list and offline mode requested.')
            return 2
        print(f'Using cached pattern list from {cache["fetched_at"]} ({age_hours:.1f} hours old).')
        if args.json:
            print(json.dumps(cache, ensure_ascii=False, indent=1)[:4000])
        return 0

    if cache and not args.force and age_hours is not None and age_hours < args.max_age_hours:
        print(f'Cached pattern list is current ({age_hours:.1f} hours old, from {cache["fetched_at"]}). '
              f'Use --force to refetch now.')
        if args.json:
            print(json.dumps(cache, ensure_ascii=False, indent=1)[:4000])
        return 0

    try:
        raw = fetch(SOURCE_URL)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        print(f'LIVE FETCH FAILED: {e}')
        if cache:
            print(f'Falling back to the cached pattern list from {cache["fetched_at"]} '
                  f'({age_hours:.1f} hours old).')
            if args.json:
                print(json.dumps(cache, ensure_ascii=False, indent=1)[:4000])
            return 0
        print('No cache available. The live list could not be reached.')
        return 3

    data = parse_wikitext(raw)
    if data['section_count'] < 10 or data['watch_word_count'] < 30:
        print('LIVE FETCH RETURNED AN UNEXPECTED STRUCTURE, cache left untouched.')
        if cache:
            return 0
        return 3

    save_cache(data)
    print(f'LIVE pattern list fetched from {PAGE_URL}')
    print(f'  fetched at      : {data["fetched_at"]}')
    print(f'  sections parsed : {data["section_count"]}')
    print(f'  watch words     : {data["watch_word_count"]}')
    if args.json:
        for s in data['sections']:
            print(f'\n## {s["name"]}')
            if s['shortcuts']:
                print('   shortcuts : ' + ', '.join(s['shortcuts']))
            if s['watch_words']:
                print('   watch     : ' + '; '.join(s['watch_words'][:40]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
