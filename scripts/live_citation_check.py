#!/usr/bin/env python3
# Copyright (c) 2026 MASH (Khaled Bhuiyan). All rights reserved. SPDX-License-Identifier: MIT.
"""Live citation check.

Verifies a reference list against the live scholarly databases and reports the
verdict for every entry. Nothing is inferred from memory: a DOI is resolved at
Crossref, a reference without a DOI is looked up by title, and a second live
source, Semantic Scholar, is asked as well. An endpoint that does not answer is
reported as a failure, never as a verdict.

The same script reads a DOCX or a plain text file of references.

    python scripts/live_citation_check.py "<file.docx>" --out-dir "<dir>"
    python scripts/live_citation_check.py "<refs.txt>" --style harvard
    python scripts/live_citation_check.py "<file.docx>" --style obu-harvard --json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

CROSSREF = "https://api.crossref.org"
SEMANTIC = "https://api.semanticscholar.org/graph/v1"
MAILTO = "mash.skill.check@example.org"
UA = "MASH-AI-Text-detector-and-Humaniser/1.0 (live citation check; mailto:%s)" % MAILTO

DOI_RE = re.compile(r"(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/[^\s\"'<>]+)", re.I)
YEAR_RE = re.compile(r"\((\d{4}[a-z]?)\)")
QUOTED_RE = re.compile(r"‘([^’]+)’|'([^']+)'")
P_RE = re.compile(r"<w:p[ >].*?</w:p>", re.S)
R_RE = re.compile(r"<w:r[ >].*?</w:r>", re.S)
T_RE = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)

STOP = {
    "the", "a", "an", "of", "and", "in", "on", "for", "to", "with", "at", "by",
    "from", "as", "is", "are", "was", "were", "be", "been", "using", "use",
}


def unescape(text: str) -> str:
    return (text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", '"').replace("&apos;", "'"))


def normalise(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokens(text: str) -> list:
    return [w for w in normalise(text).split(" ") if w and w not in STOP]


def similarity(a: str, b: str) -> float:
    """Token containment of the shorter string inside the longer one."""
    ta, tb = set(tokens(a)), set(tokens(b))
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / float(min(len(ta), len(tb)))


def fetch(url: str, timeout: int = 30, retries: int = 3) -> tuple:
    """Return (status, payload). status is an int, or the string FAIL plus a reason."""
    last = ""
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                return resp.status, json.loads(body)
        except urllib.error.HTTPError as exc:
            if exc.code in (404, 429, 500, 502, 503):
                last = "HTTP %d" % exc.code
                time.sleep(1.5 * (attempt + 1))
                continue
            return "FAIL", "HTTP %d %s" % (exc.code, exc.reason)
        except Exception as exc:  # network, TLS, JSON
            last = "%s: %s" % (type(exc).__name__, exc)
            time.sleep(1.5 * (attempt + 1))
    return "FAIL", last


def crossref_doi(doi: str) -> tuple:
    url = "%s/works/%s?mailto=%s" % (CROSSREF, urllib.parse.quote(doi, safe=""), MAILTO)
    status, payload = fetch(url)
    if status == 200 and isinstance(payload, dict) and payload.get("message"):
        return "OK", payload["message"]
    if status == 404:
        return "NOT_FOUND", None
    return "FAIL", payload


def crossref_query(title: str, rows: int = 3) -> tuple:
    params = urllib.parse.urlencode({
        "query.bibliographic": title,
        "rows": rows,
        "select": "DOI,title,author,issued,published-print,published-online,container-title,volume,issue,page,type,publisher",
        "mailto": MAILTO,
    })
    status, payload = fetch("%s/works?%s" % (CROSSREF, params))
    if status == 200 and isinstance(payload, dict):
        return "OK", payload.get("message", {}).get("items", [])
    return "FAIL", payload


def semantic_query(title: str, limit: int = 3) -> tuple:
    params = urllib.parse.urlencode({
        "query": title,
        "limit": limit,
        "fields": "title,year,authors,venue,externalIds",
    })
    status, payload = fetch("%s/paper/search?%s" % (SEMANTIC, params))
    if status == 200 and isinstance(payload, dict):
        return "OK", payload.get("data", [])
    return "FAIL", payload


def record_year(record: dict) -> str:
    for key in ("published-print", "published-online", "issued"):
        block = record.get(key)
        if isinstance(block, dict) and block.get("date-parts"):
            parts = block["date-parts"][0]
            if parts and parts[0]:
                return str(parts[0])
    return ""


def record_title(record: dict) -> str:
    titles = record.get("title") or []
    return titles[0] if titles else ""


def record_container(record: dict) -> str:
    names = record.get("container-title") or []
    return names[0] if names else ""


def record_authors(record: dict) -> str:
    authors = record.get("author") or []
    if not authors:
        return ""
    return authors[0].get("family", "")


def record_pages(record: dict) -> str:
    page = record.get("page") or ""
    if page:
        return page
    art = record.get("article-number") or ""
    return art


def parse_entry(text: str) -> dict:
    """Split one reference into the fields the databases can be asked about."""
    entry = {"raw": text.strip(), "doi": "", "year": "", "title": "", "authors_raw": "",
             "container": "", "volume": "", "issue": "", "pages": "", "url": ""}
    m = DOI_RE.search(text)
    if m:
        entry["doi"] = m.group(1).rstrip(".,;")
    y = YEAR_RE.search(text)
    if y:
        entry["year"] = y.group(1)
    # the title is read from the text after the year, so that an apostrophe in a
    # surname, for example O'Riordan, is never mistaken for an opening quote
    after = text[y.end():] if y else text
    after = after.lstrip(" )")
    q = QUOTED_RE.search(after)
    if q:
        entry["title"] = (q.group(1) or q.group(2)).strip()
    else:
        # a book, report or web page: the title sits between the year and the next full stop
        title = re.split(r"\.\s|\.\Z", after)[0].strip()
        entry["title"] = title
    # container: the text after the closing quote of the article title
    if q:
        tail = after[q.end():]
        tail = re.sub(r"^\s*,?\s*", "", tail)
        tail = re.split(r"\.\s+Available at|\.\s*$|\.\s+https", tail)[0]
        vol = re.search(r"[, ]\s*(\d+)\s*(?:\((\d+)\))?", tail)
        if vol:
            entry["volume"] = vol.group(1)
            entry["issue"] = vol.group(2) or ""
            entry["container"] = tail[:vol.start()].strip().strip(",")
        else:
            entry["container"] = tail.strip().strip(",")
    if y:
        entry["authors_raw"] = text[:y.start()].strip(" .")
    pg = re.search(r"pp?\.\s*([\w\-–]+)", text)
    if pg:
        entry["pages"] = pg.group(1)
    u = re.search(r"(https?://\S+)", text)
    if u:
        entry["url"] = u.group(1).rstrip(".,;")
    if entry["title"]:
        entry["title"] = entry["title"].strip(" .")
    return entry


def check_entry(entry: dict, deep: bool = True) -> dict:
    """Verify one reference against the live databases."""
    result = {
        "raw": entry["raw"],
        "doi": entry["doi"],
        "title": entry["title"],
        "year": entry["year"],
        "verdict": "",
        "detail": "",
        "source": "",
        "record": {},
        "differences": [],
        "live": "NONE",
    }
    if entry["doi"]:
        status, record = crossref_doi(entry["doi"])
        if status == "NOT_FOUND":
            result["verdict"] = "DOI MISMATCH"
            result["detail"] = "the DOI does not resolve at Crossref"
            result["live"] = "CROSSREF:404"
            return result
        if status == "FAIL":
            result["verdict"] = "CHECK FAILED"
            result["detail"] = "Crossref did not answer: %s" % record
            result["live"] = "CROSSREF:FAIL"
            return result
        result["live"] = "CROSSREF:OK"
        result["source"] = "Crossref"
        title = record_title(record)
        score = similarity(entry["title"], title)
        first_author = record_authors(record)
        ref_first = entry["authors_raw"].split(",")[0].split(" and ")[0].strip()
        ref_surname = re.sub(r"[^A-Za-z\- ]", "", ref_first).split(" ")[-1].strip().lower()
        year_hit = record_year(record)
        result["record"] = {
            "title": title,
            "authors": ", ".join(
                "%s %s" % (a.get("given", ""), a.get("family", ""))
                for a in (record.get("author") or [])[:6]
            ),
            "container": record_container(record),
            "year": year_hit,
            "volume": record.get("volume", ""),
            "issue": record.get("issue", ""),
            "pages": record_pages(record),
            "doi": record.get("DOI", ""),
            "authors_full": [
                "%s, %s" % (a.get("family", ""), a.get("given", ""))
                for a in (record.get("author") or [])
            ],
        }
        author_hit = bool(ref_surname) and ref_surname in first_author.lower()
        year_ok = (not entry["year"]) or (not year_hit) or entry["year"][:4] == year_hit[:4]
        if score >= 0.8 and (author_hit or not ref_surname):
            result["verdict"] = "VERIFIED"
            result["detail"] = "the DOI resolves to a real record and the title matches"
            if not year_ok:
                result["verdict"] = "METADATA DIFFERENCE"
                result["differences"].append(
                    "year in the reference is %s, the record gives %s" % (entry["year"], year_hit))
            if not author_hit and ref_surname:
                result["differences"].append(
                    "first author in the reference is %s, the record gives %s"
                    % (ref_surname, first_author))
            for label, ref_value, rec_value in (
                ("volume", entry["volume"], record.get("volume", "")),
                ("issue", entry["issue"], record.get("issue", "")),
                ("pages", entry["pages"], record_pages(record)),
            ):
                if ref_value and rec_value and not _same_number(ref_value, rec_value):
                    result["differences"].append(
                        "%s in the reference is %s, the record gives %s"
                        % (label, ref_value, rec_value))
            if result["differences"]:
                result["verdict"] = "METADATA DIFFERENCE"
                result["detail"] = "the DOI resolves to the right work, but a detail differs"
        else:
            result["verdict"] = "DOI MISMATCH"
            result["detail"] = ("the DOI resolves to a different work (title similarity %.2f)"
                                 % score)
        if deep and result["verdict"] == "METADATA DIFFERENCE":
            status2, payload2 = semantic_query(entry["title"])
            if status2 == "OK":
                result["live"] += ", SEMANTIC:OK"
                for cand in payload2:
                    if similarity(entry["title"], cand.get("title", "")) >= 0.8:
                        result["record"]["semantic_scholar_year"] = cand.get("year", "")
                        break
            else:
                result["live"] += ", SEMANTIC:FAIL"
        return result

    # no DOI: look the title up in both databases
    if not entry["title"]:
        result["verdict"] = "VERIFY MANUALLY"
        result["detail"] = "no title could be read from the entry"
        return result
    status, items = crossref_query(entry["title"])
    best = None
    best_score = 0.0
    if status == "OK":
        for item in items:
            score = similarity(entry["title"], record_title(item))
            if score > best_score:
                best, best_score = item, score
    else:
        result["live"] = "CROSSREF:FAIL"
    if best is not None and best_score >= 0.85:
        best_year = record_year(best)
        year_clash = bool(entry["year"]) and bool(best_year) and entry["year"][:4] != best_year[:4]
        result["verdict"] = "VERIFY MANUALLY" if year_clash else "MATCH FOUND"
        result["source"] = "Crossref"
        result["live"] = "CROSSREF:OK" if status == "OK" else "CROSSREF:FAIL"
        if year_clash:
            result["detail"] = ("the closest record with this title is a different work, "
                                "published in %s" % best_year)
        else:
            result["detail"] = "a real record matches the title, author and year"
        result["record"] = {
            "title": record_title(best),
            "authors": ", ".join(
                "%s %s" % (a.get("given", ""), a.get("family", ""))
                for a in (best.get("author") or [])[:6]
            ),
            "container": record_container(best),
            "year": best_year,
            "volume": best.get("volume", ""),
            "issue": best.get("issue", ""),
            "pages": record_pages(best),
            "doi": best.get("DOI", ""),
            "authors_full": [
                "%s, %s" % (a.get("family", ""), a.get("given", ""))
                for a in (best.get("author") or [])
            ],
        }
    else:
        status2, items2 = semantic_query(entry["title"])
        sem_best, sem_score = None, 0.0
        if status2 == "OK":
            for cand in items2:
                score = similarity(entry["title"], cand.get("title", ""))
                if score > sem_score:
                    sem_best, sem_score = cand, score
            result["live"] += ", SEMANTIC:OK"
        else:
            result["live"] += ", SEMANTIC:FAIL"
        if sem_best is not None and sem_score >= 0.85:
            sem_year = str(sem_best.get("year", "") or "")
            year_clash = bool(entry["year"]) and bool(sem_year) and entry["year"][:4] != sem_year[:4]
            result["verdict"] = "VERIFY MANUALLY" if year_clash else "MATCH FOUND"
            result["source"] = "Semantic Scholar"
            if year_clash:
                result["detail"] = ("the closest record with this title is a different work, "
                                    "published in %s" % sem_year)
            else:
                result["detail"] = "a real record matches the title, author and year"
            result["record"] = {
                "title": sem_best.get("title", ""),
                "authors": ", ".join(
                    a.get("name", "") for a in (sem_best.get("authors") or [])[:6]),
                "container": sem_best.get("venue", ""),
                "year": sem_year,
                "doi": (sem_best.get("externalIds") or {}).get("DOI", ""),
            }
        else:
            result["verdict"] = "VERIFY MANUALLY"
            result["detail"] = ("no record was found in the databases that were checked; "
                                "books, reports and very recent work are often absent")
    return result


def _same_number(a: str, b: str) -> bool:
    def digits(value):
        return set(re.findall(r"\d+", value))
    da, db = digits(a), digits(b)
    if not da or not db:
        return True
    return da == db or da & db


def docx_runs(path: str) -> list:
    """Return the paragraphs of a DOCX as a list of run lists."""
    with zipfile.ZipFile(path) as zf:
        xml = zf.read("word/document.xml").decode("utf-8")
    body = xml.split("<w:body>", 1)[-1]
    paragraphs = []
    for block in P_RE.findall(body):
        runs = []
        for run in R_RE.findall(block):
            text = "".join(T_RE.findall(run))
            if not text:
                continue
            rpr = re.search(r"<w:rPr>(.*?)</w:rPr>", run, re.S)
            props = rpr.group(1) if rpr else ""
            italic = "<w:i/>" in props or "<w:i " in props
            bold = "<w:b/>" in props
            runs.append({"text": unescape(text), "italic": italic, "bold": bold})
        paragraphs.append(runs)
    return paragraphs


def split_sections(paragraphs: list) -> tuple:
    """Split the paragraphs into the body and the reference list."""
    body, refs = [], []
    in_refs = False
    for runs in paragraphs:
        text = "".join(r["text"] for r in runs).strip()
        if text.lower() in ("references", "reference list", "bibliography"):
            in_refs = True
            continue
        (refs if in_refs else body).append(runs)
    return body, refs


def style_report(body: list, refs: list, eta_italic: bool) -> list:
    """Offline style findings: italic 'et al.', italic journal title, italic work title."""
    findings = []

    def scan(runs, where):
        joined = "".join(r["text"] for r in runs)
        index = []
        for ri, r in enumerate(runs):
            index.extend([ri] * len(r["text"]))
        for m in re.finditer(r"et al\.?", joined):
            r0 = index[m.start()]
            r1 = index[max(m.start(), m.end() - 1)]
            if not all(runs[ri]["italic"] for ri in range(r0, r1 + 1)):
                findings.append({
                    "kind": "et al. not italic",
                    "where": where,
                    "text": joined[max(0, m.start() - 40):m.end() + 15],
                })

    for runs in body:
        scan(runs, "in-text")
    for runs in refs:
        scan(runs, "reference list")
    return findings


def load_style(styles_path: str, name: str) -> dict:
    with open(styles_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    styles = data.get("styles", {})
    if name not in styles:
        sys.stderr.write("unknown style %s, known styles: %s\n"
                         % (name, ", ".join(sorted(styles))))
        sys.exit(2)
    return styles[name]


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description="Live citation check against Crossref and Semantic Scholar")
    ap.add_argument("path", help="a DOCX file or a text file holding one reference per line")
    ap.add_argument("--style", default="harvard", help="style name from rules/citation_styles.json")
    ap.add_argument("--out-dir", default=None, help="folder for the report and the JSON record")
    ap.add_argument("--json", action="store_true", help="print the JSON record only")
    ap.add_argument("--no-deep", action="store_true", help="skip the second lookup on a difference")
    args = ap.parse_args()

    styles_path = os.path.join(here, "..", "rules", "citation_styles.json")
    style = load_style(styles_path, args.style)

    body, refs = [], []
    if args.path.lower().endswith(".docx"):
        paragraphs = docx_runs(args.path)
        body, refs = split_sections(paragraphs)
        entries = []
        for runs in refs:
            text = "".join(r["text"] for r in runs).strip()
            if text:
                entries.append(text)
    else:
        with open(args.path, "r", encoding="utf-8") as fh:
            entries = [line.strip() for line in fh if line.strip()]

    results = []
    for index, text in enumerate(entries, 1):
        entry = parse_entry(text)
        result = check_entry(entry, deep=not args.no_deep)
        result["index"] = index
        results.append(result)
        sys.stderr.write("[%d/%d] %-18s %s\n"
                         % (index, len(entries), result["verdict"],
                            (entry["title"] or text)[:70]))
        time.sleep(0.3)

    findings = style_report(body, refs, style.get("etaItalic", False))

    tally = {}
    for result in results:
        tally[result["verdict"]] = tally.get(result["verdict"], 0) + 1

    record = {
        "tool": "live_citation_check",
        "source_file": os.path.abspath(args.path),
        "style": args.style,
        "entries": len(entries),
        "tally": tally,
        "style_findings": findings,
        "results": results,
    }

    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.path))
    json_path = os.path.join(out_dir, "live-citation-check.json")
    report_path = os.path.join(out_dir, "live-citation-check.txt")
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2, ensure_ascii=False)
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write(render_report(record, entries))

    if args.json:
        print(json.dumps(record, indent=2, ensure_ascii=False))
    else:
        print(render_report(record, entries))
        print("report: %s" % report_path)
        print("record: %s" % json_path)
    return 0


def render_report(record: dict, entries: list) -> str:
    out = []
    out.append("LIVE CITATION CHECK")
    out.append("source file: %s" % record["source_file"])
    out.append("style: %s" % record["style"])
    out.append("entries checked: %d" % record["entries"])
    out.append("live sources: Crossref REST API, Semantic Scholar Graph API")
    out.append("=" * 70)
    for verdict in sorted(record["tally"]):
        out.append("%-18s %d" % (verdict, record["tally"][verdict]))
    out.append("")
    for result, entry in zip(record["results"], entries):
        out.append("%2d. %s" % (result["index"], result["verdict"]))
        out.append("    reference: %s" % result["raw"][:200])
        if result["detail"]:
            out.append("    detail:   %s" % result["detail"])
        if result["live"]:
            out.append("    live:     %s" % result["live"])
        rec = result.get("record") or {}
        if rec:
            out.append("    record:   %s" % rec.get("title", ""))
            out.append("    source:   %s%s%s" % (
                rec.get("container", ""),
                ", " if rec.get("volume") else "",
                rec.get("volume", "")))
            if rec.get("year"):
                out.append("    year:     %s" % rec["year"])
            if rec.get("doi"):
                out.append("    doi:      https://doi.org/%s" % rec["doi"])
        for diff in result.get("differences", []):
            out.append("    DIFF:     %s" % diff)
        out.append("")
    if record["style_findings"]:
        out.append("STYLE FINDINGS")
        for finding in record["style_findings"]:
            out.append("  %s | %s | %s" % (finding["kind"], finding["where"], finding["text"]))
    else:
        out.append("STYLE FINDINGS: none")
    out.append("")
    out.append("A verdict of VERIFY MANUALLY means the databases did not return a record.")
    out.append("It is not a verdict of guilt: books, reports, chapters and very recent")
    out.append("work are often absent from these indexes. CHECK FAILED means an")
    out.append("endpoint did not answer, and it is reported as a failure, never as a")
    out.append("verdict on the reference.")
    return "\n".join(out)


if __name__ == "__main__":
    sys.exit(main())
