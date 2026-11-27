#!/usr/bin/env python3
"""Build insiders.json for the Finance chart's Insiders layer —
open-market buys and sells (SEC Form 4 transaction codes P and S
only) by officers, directors and 10% owners of the companies the
page covers, trailing 12 months.

Source: SEC EDGAR (free, public). Form 4 reports EXACT shares and
prices — the opposite of Congress's statutory ranges — and the
layer says so wherever it shows them.

Discipline, mirroring the politicians pipeline:
- Descriptive User-Agent, polite rate (<= ~8 requests/second).
- Completeness guard: if fewer than 95% of the universe's
  tickers were pulled cleanly, the run FAILS and publishes
  nothing — a truncated pull never ships dressed as complete.
- Only non-derivative transactions with code P (open-market
  purchase) or S (open-market sale) count. Grants (A), option
  exercises (M), gifts (G), tax withholding (F) and everything
  else are excluded by the code filter, never by guessing.
- STRC and SATS are excluded from the universe: they are
  preferred shares of an issuer whose insiders file under the
  common stock's record, so per-ticker attribution would be
  guesswork.

Run: python3 insiders_build.py [--full]
  Default (CI) mode: if insiders.json already exists at OUT,
  pull only the last 60 days of filings and merge (dedupe on the
  full row), then prune trades older than the window. --full
  (or no existing file) pulls the whole trailing 12 months.
"""
import json
import os
import sys
import time
import requests
import xml.etree.ElementTree as ET
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UA = "onealjb93.github.io johnny-website@muse.ai"
OUT = os.environ.get("INS_OUT", "insiders.json")
# Locally the price file and caches live under ../raw; in CI the
# checkout's own finance-chart-daily.json is the price file and
# caches sit in the working directory.
RAW = os.path.join(ROOT, "raw") if os.path.isdir(os.path.join(ROOT, "raw")) else "."
CACHE = os.path.join(RAW, "insiders_cache")
WINDOW_DAYS = 366
MERGE_DAYS = 60
NON_EQUITY = {"SPX", "IXIC", "RUT", "VIX", "TNX", "DOLLAR", "EURO", "GOLD",
              "SILVER", "COPPER", "OIL", "BRENT", "NATGAS", "CORN", "WHEAT",
              "BTC", "STRC", "SATS"}
EPOCH = date(1970, 1, 1)

_last = [0.0]
_session = [None]


def _get_session():
    # EDGAR's front door refused the stdlib urllib client from
    # the CI runners (403 on the very first request, Actions run
    # 46058270264, 2026-11-27) even with the declared User-Agent
    # below. The same declared agent sent through requests — the
    # client the politicians builder already uses — is the fix.
    if _session[0] is None:
        s = requests.Session()
        s.headers.update({
            "User-Agent": UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
        })
        _session[0] = s
    return _session[0]


def fetch(url, binary=False):
    # polite global pacing: at most ~8 requests/second
    wait = _last[0] + 0.13 - time.time()
    if wait > 0:
        time.sleep(wait)
    s = _get_session()
    try:
        r = s.get(url, timeout=30)
        r.raise_for_status()
        data = r.content
    except Exception:
        time.sleep(2.0)
        r = s.get(url, timeout=30)
        r.raise_for_status()
        data = r.content
    _last[0] = time.time()
    return data if binary else data.decode("utf-8", "replace")


def epoch_day(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return (date(y, m, d) - EPOCH).days


def universe():
    src = os.path.join(RAW, "board_prices.json")
    if not os.path.exists(src):
        src = "finance-chart-daily.json"
    bp = json.load(open(src))
    return sorted(k for k in bp["series"].keys() if k not in NON_EQUITY)


def cik_map(tickers):
    path = os.path.join(RAW, "company_tickers.json")
    if not os.path.exists(path):
        raw = fetch("https://www.sec.gov/files/company_tickers.json")
        with open(path, "w") as f:
            f.write(raw)
    data = json.load(open(path))
    by_ticker = {}
    for row in data.values():
        by_ticker[row["ticker"]] = (int(row["cik_str"]), row["title"])
    missing = [t for t in tickers if t not in by_ticker]
    return by_ticker, missing


def filing_list(cik, since_iso):
    """(accession, primary_doc, filed_iso) for Form 4s filed on or
    after since_iso, walking EDGAR's history shards if the recent
    list does not reach back far enough."""
    out = []

    def take(forms, dates, accs, docs):
        stop = True
        for f, d, a, doc in zip(forms, dates, accs, docs):
            if f == "4" and d >= since_iso:
                out.append((a, doc, d))
            if d >= since_iso:
                stop = False
        return stop

    sub = json.loads(fetch("https://data.sec.gov/submissions/CIK%010d.json" % cik))
    recent = sub["filings"]["recent"]
    stop = take(recent["form"], recent["filingDate"], recent["accessionNumber"], recent["primaryDocument"])
    shards = sub["filings"].get("files") or []
    n = 0
    while not stop and n < len(shards) and n < 4:
        shard = json.loads(fetch("https://data.sec.gov/submissions/" + shards[n]["name"]))
        stop = take(shard["form"], shard["filingDate"], shard["accessionNumber"], shard["primaryDocument"])
        n += 1
    return out


def text_of(node, path):
    el = node.find(path) if node is not None else None
    if el is None:
        return None
    v = el.find("value")
    if v is not None and v.text:
        return v.text.strip()
    return el.text.strip() if el.text else None


def parse_form4(xml_text, win_start_iso):
    """Rows: [tradedDayNum, side, shares, price, name, role] for
    non-derivative P/S transactions inside the window."""
    i = xml_text.find("<ownershipDocument")
    if i < 0:
        return []
    try:
        root = ET.fromstring(xml_text[i:])
    except ET.ParseError:
        return []
    owner = root.find("reportingOwner")
    name = text_of(owner, "reportingOwnerId/rptOwnerName") or ""
    rel = owner.find("reportingOwnerRelationship") if owner is not None else None

    def flag(tag):
        t = text_of(rel, tag)
        return t in ("1", "true")

    if rel is not None and flag("isOfficer"):
        role = text_of(rel, "officerTitle") or "Officer"
    elif rel is not None and flag("isDirector"):
        role = "Director"
    elif rel is not None and flag("isTenPercentOwner"):
        role = "10% owner"
    else:
        role = "Insider"
    name = " ".join(w.title() if w.isupper() else w for w in name.split())
    rows = []
    table = root.find("nonDerivativeTable")
    if table is None:
        return []
    for txn in table.findall("nonDerivativeTransaction"):
        code = text_of(txn, "transactionCoding/transactionCode")
        if code not in ("P", "S"):
            continue
        diso = text_of(txn, "transactionDate")
        if not diso or diso < win_start_iso:
            continue
        try:
            shares = float(text_of(txn, "transactionAmounts/transactionShares/value"))
            price = float(text_of(txn, "transactionAmounts/transactionPricePerShare/value"))
        except (TypeError, ValueError):
            continue
        rows.append([epoch_day(diso), 0 if code == "P" else 1,
                     int(shares) if shares == int(shares) else shares,
                     round(price, 4), name, role])
    return rows


def main():
    full = "--full" in sys.argv
    today = date.today()
    win_start = today - timedelta(days=WINDOW_DAYS)
    win_iso = win_start.isoformat()
    existing = None
    if os.path.exists(OUT) and not full:
        try:
            existing = json.load(open(OUT))
        except Exception:
            existing = None
    pull_since = win_iso if (full or not existing) else (today - timedelta(days=MERGE_DAYS)).isoformat()
    tickers = universe()
    by_ticker, missing = cik_map(tickers)
    if missing:
        print("[insiders] no CIK for: %s" % ", ".join(missing), flush=True)
    os.makedirs(CACHE, exist_ok=True)
    data = {}
    if existing:
        data = {t: [list(r) for r in rows] for t, rows in existing.get("tickers", {}).items()}
    failed = []
    total_new = 0
    for t in tickers:
        if t not in by_ticker:
            failed.append(t)
            continue
        cik, _title = by_ticker[t]
        try:
            filings = filing_list(cik, pull_since)
        except Exception as e:
            print("[insiders] %s filing list failed: %s" % (t, e), flush=True)
            failed.append(t)
            continue
        got = []
        for acc, doc, _filed in filings:
            nodash = acc.replace("-", "")
            cpath = os.path.join(CACHE, nodash + ".xml")
            try:
                if os.path.exists(cpath):
                    xml_text = open(cpath, encoding="utf-8", errors="replace").read()
                else:
                    xml_text = fetch("https://www.sec.gov/Archives/edgar/data/%d/%s/%s" % (cik, nodash, doc))
                    with open(cpath, "w", encoding="utf-8") as f:
                        f.write(xml_text)
                got.extend(parse_form4(xml_text, win_iso))
            except Exception as e:
                print("[insiders] %s %s failed: %s" % (t, acc, e), flush=True)
        if got:
            if t in data:
                seen = {tuple(r) for r in data[t]}
                for r in got:
                    if tuple(r) not in seen:
                        data[t].append(r)
                        total_new += 1
            else:
                data[t] = got
                total_new += len(got)
        print("[insiders] %s: %d filings, %d P/S rows (total %d)" % (t, len(filings), len(got), total_new), flush=True)
    # prune to the window and sort
    floor = epoch_day(win_iso)
    out_tickers = {}
    n_rows = 0
    for t, rows in data.items():
        rows = sorted({tuple(r) for r in rows if r[0] >= floor})
        if rows:
            out_tickers[t] = [list(r) for r in rows]
            n_rows += len(rows)
    covered = len(tickers) - len(failed)
    print("[insiders] covered %d/%d tickers, %d rows" % (covered, len(tickers), n_rows), flush=True)
    if covered < 0.95 * len(tickers):
        print("[insiders] FAIL: coverage below 95% — publishing nothing", flush=True)
        sys.exit(1)
    if n_rows == 0:
        print("[insiders] FAIL: zero rows — publishing nothing", flush=True)
        sys.exit(1)
    out = {
        "asOf": today.isoformat(),
        "windowFrom": win_iso,
        "counts": {"tickers": covered, "rows": n_rows},
        "method": ("Open-market purchases (code P) and sales (code S) by officers, directors and 10% owners, "
                   "from SEC Form 4 filings — exact shares and prices as filed. Grants, option exercises, "
                   "gifts and tax withholding are not open-market trades and are excluded."),
        "tickers": out_tickers,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print("[insiders] wrote %s — %d rows across %d tickers, %.0f KB" % (OUT, n_rows, len(out_tickers), os.path.getsize(OUT) / 1024.0), flush=True)


if __name__ == "__main__":
    main()
