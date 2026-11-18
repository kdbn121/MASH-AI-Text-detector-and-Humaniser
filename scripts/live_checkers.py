#!/usr/bin/env python3
"""Attempt live similarity and AI writing checks, and prepare the text for a manual check.

Three things happen here:

1. The body text is extracted with the cover page (title page), the contents page and
   the reference list removed, and written out in chunks that fit the character limit used
   by the common free checkers.
2. Each free checker endpoint that can be called without an account is tried live.
3. For every checker, whether or not the call succeeded, the exact manual command is
   printed, so the check can always be completed by hand in a browser.

No checker score is ever invented. If a call fails, the failure is reported as a failure.

Usage:
  python scripts/live_checkers.py "<file.docx>" [--chunk-chars 15000] [--out-dir <dir>]
  python scripts/live_checkers.py "<file.docx>" --list
"""
import argparse
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pattern_lint import docx_units, text_units, drop_title_page_and_refs  # noqa: E402

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0 Safari/537.36')

# Free checkers. url is the page to open by hand, api is an endpoint that may answer
# without an account. The manual step is always printed, whatever the API does.
CHECKERS = [
    {
        'name': 'ZeroGPT',
        'url': 'https://www.zerogpt.com',
        'api': 'https://api.zerogpt.com/v1/detect',
        'method': 'POST',
        'body': 'text={text}',
        'manual': 'Open https://www.zerogpt.com, paste the chunk into Detect Text, '
                  'press check, and read the AI verdict and the highlighted sentences.',
        'note': 'The free web tool reads a limited number of characters per check and scores '
                'the pasted text, not your file. Paste one chunk at a time.',
    },
    {
        'name': 'GPTZero',
        'url': 'https://gptzero.me',
        'api': None,
        'manual': 'Open https://gptzero.me, sign in with a free account, paste the chunk into '
                  'the detector and read the AI and plagiarism percentages.',
        'note': 'Free web use, account needed. Reports an AI percentage and a similarity percentage.',
    },
    {
        'name': 'Originality.ai',
        'url': 'https://originality.ai',
        'api': None,
        'manual': 'Open https://originality.ai, use the free scan on the chunk, and read the '
                  'AI probability and the plagiarism percentage.',
        'note': 'Free scan credits on signup.',
    },
    {
        'name': 'Copyleaks',
        'url': 'https://copyleaks.com',
        'api': None,
        'manual': 'Open https://copyleaks.com and run the free plagiarism or AI report on the chunk.',
        'note': 'Free report without an account for a limited number of pages.',
    },
    {
        'name': 'Plagiarism Checker AI',
        'url': 'https://plagiarismchecker.ai/',
        'api': None,
        'manual': 'Open https://plagiarismchecker.ai/, paste the chunk into the text box and press '
                  'Check Plagiarism for a similarity figure, or open '
                  'https://plagiarismchecker.ai/ai-content-detector/, paste the chunk, press Detect '
                  'AI content and read the Human and AI Written percentages.',
        'note': 'Free web check, no account needed, no consent wall. The free word limit is about '
                '1,000 words per check, so a long document needs several checks. Verified live from '
                'this machine on 2026-11-18.',
    },
    {
        'name': 'Undetectable AI',
        'url': 'https://undetectable.ai',
        'api': None,
        'manual': 'Open https://undetectable.ai and run the free detector on the chunk.',
        'note': 'Free web detector.',
    },
]


def extract(path):
    if path.lower().endswith('.docx'):
        units = docx_units(path)
    else:
        units = text_units(path)
    units, scope_note = drop_title_page_and_refs(units)
    return units, scope_note


def chunks_from(units, size):
    text = '\n\n'.join(u['text'].strip() for u in units if u['text'].strip())
    out = []
    while text:
        if len(text) <= size:
            out.append(text)
            break
        cut = text.rfind(' ', 0, size)
        if cut < size // 2:
            cut = size
        out.append(text[:cut])
        text = text[cut:].lstrip()
    return out


def try_api(checker, text, timeout=30):
    api = checker.get('api')
    if not api:
        return None, 'no callable endpoint, web check only'
    payload = checker.get('body', '').replace('{text}', text[:6000]).encode('utf-8')
    headers = {'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded'}
    req = urllib.request.Request(api, data=payload, headers=headers, method=checker.get('method', 'POST'))
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            body = r.read(4000).decode('utf-8', 'replace')
            return True, body
    except urllib.error.HTTPError as e:
        return False, f'HTTP {e.code} {e.reason}'
    except Exception as e:
        return False, f'{type(e).__name__}: {e}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('file', nargs='?')
    ap.add_argument('--chunk-chars', type=int, default=15000)
    ap.add_argument('--out-dir')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()

    if args.list or not args.file:
        print('Live checkers this skill can try, and the manual command for each:\n')
        for c in CHECKERS:
            print(f'{c["name"]}')
            print(f'  site   : {c["url"]}')
            print(f'  manual : {c["manual"]}')
            if c.get('note'):
                print(f'  note   : {c["note"]}')
            print()
        print('No score from any of these can be guaranteed, and none is ever invented here.')
        return 0

    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.file))
    os.makedirs(out_dir, exist_ok=True)
    units, scope_note = extract(args.file)
    chunks = chunks_from(units, args.chunk_chars)
    base = os.path.splitext(os.path.basename(args.file))[0]

    written = []
    for i, c in enumerate(chunks, 1):
        p = os.path.join(out_dir, f'{base}.check-chunk{i}.txt')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(c)
        written.append((p, len(c)))

    print('=== Live check preparation ===')
    print(f'File            : {args.file}')
    print(f'Units extracted : {len(units)} (title page and reference list removed)')
    print(f'Scope           : {scope_note}')
    if not units:
        print('WARNING         : nothing was extracted, so there is nothing to check')
    print(f'Chunks written  : {len(written)}')
    for p, n in written:
        print(f'  {p}  ({n} characters)')
    print()

    print('=== Live endpoint attempts ===')
    results = []
    sample = chunks[0][:6000] if chunks else ''
    for c in CHECKERS:
        ok, detail = try_api(c, sample)
        state = 'ANSWERED' if ok else ('NOT CALLED' if detail.startswith('no callable') else 'FAILED')
        print(f'{c["name"]}: {state} - {detail[:160]}')
        results.append({'checker': c['name'], 'state': state, 'detail': detail[:200],
                        'url': c['url'], 'manual': c['manual']})
    print()

    print('=== Manual commands, run these when a call did not answer ===')
    for c in CHECKERS:
        print(f'{c["name"]}: {c["manual"]}')
    print()
    print('Note: paste one chunk file at a time. Report the number the checker gives for the')
    print('chunk, and say which chunk it was. No checker score can be guaranteed, and this')
    print('script never reports a score that a checker did not return.')

    out = {
        'file': args.file,
        'units': len(units),
        'scope': scope_note,
        'chunks': [{'path': p, 'chars': n} for p, n in written],
        'endpoints': results,
    }
    pj = os.path.join(out_dir, f'{base}.live-check.json')
    with open(pj, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'\nWrote {pj}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
