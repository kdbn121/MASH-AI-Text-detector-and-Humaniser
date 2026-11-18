"""Render the project images with headless Chrome.

Usage: python docs/images/source/render_images.py

Each HTML source in this folder is copied to a unique temporary name before it is
rendered, because Chrome caches file:// pages hard on this machine and a second
render of the same path can come back as the previous image.
"""

import os
import shutil
import subprocess
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = HERE
OUT = os.path.dirname(HERE)

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

JOBS = [
    ("card.html", "mash-card.png", 1600, 1000),
    ("social-preview.html", "social-preview.png", 1280, 640),
    ("chain-diagram.html", "chain-diagram.png", 1600, 620),
]


def find_chrome():
    for candidate in CHROME_CANDIDATES:
        if os.path.exists(candidate):
            return candidate
    return None


def render(chrome, html_name, png_name, w, h):
    token = uuid.uuid4().hex[:10]
    tmp_html = os.path.join(OUT, "_tmp_" + token + ".html")
    shutil.copy2(os.path.join(SRC, html_name), tmp_html)
    out_png = os.path.join(OUT, png_name)
    if os.path.exists(out_png):
        os.remove(out_png)

    profile = os.path.join(os.environ.get("TEMP", OUT), "chrome-prof-" + token)
    args = [
        chrome,
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--incognito",
        "--disk-cache-size=1",
        "--user-data-dir=" + profile,
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=12000",
        "--window-size=%d,%d" % (w, h),
        "--screenshot=" + out_png,
        "file:///" + tmp_html.replace("\\", "/"),
    ]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=180)
        stderr = result.stderr or ""
    except subprocess.TimeoutExpired:
        stderr = "timeout after 180 seconds"

    ok = os.path.exists(out_png) and os.path.getsize(out_png) > 1000
    try:
        os.remove(tmp_html)
    except OSError:
        pass
    shutil.rmtree(profile, ignore_errors=True)
    size = os.path.getsize(out_png) if os.path.exists(out_png) else 0
    print(("  OK   " if ok else "  FAIL ") + png_name + "  " + str(size) + " bytes")
    if not ok:
        print("        stderr tail: " + stderr[-400:].replace("\n", " | "))
    return ok


if __name__ == "__main__":
    chrome = find_chrome()
    if not chrome:
        print("Chrome or Chromium was not found on this machine.")
        print("Install Google Chrome, or open each HTML source in this folder and take the screenshot by hand.")
        sys.exit(2)

    os.makedirs(OUT, exist_ok=True)
    allok = True
    for html_name, png_name, w, h in JOBS:
        allok = render(chrome, html_name, png_name, w, h) and allok
    print()
    print("all rendered" if allok else "one or more failed")
    sys.exit(0 if allok else 1)
