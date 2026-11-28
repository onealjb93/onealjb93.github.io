#!/usr/bin/env python3
"""Dilution & Buybacks — share-count data builder (2026-11-28).

Builds dilution-data.json: period-end shares outstanding for every
company in the Finance page's chart universe (finance-chart-daily.json),
as a STEP series — one dated observation per filing, never interpolated.

Sources, in order of authority:
  1. SEC EDGAR company-concept API: dei EntityCommonStockSharesOutstanding
     (the cover-page count), merged with us-gaap
     CommonStockSharesOutstanding (the balance-sheet count) — per
     period end, the latest-filed figure wins.
  2. The filings themselves. Multi-class filers (Meta, Strategy,
     Airbnb, Shopify…) tag their cover count per share class, and
     the concept API drops class-dimensioned facts entirely — for
     those names the builder reads the XBRL instance document of
     each periodic report and sums the classes at each cover date.
     The same route rescues a name whose concept data has gone
     stale. Nothing here is estimated: a filing either states the
     count or the name ships without steps.
  3. Yahoo Finance v8 split events: EDGAR counts are as reported on
     their day, so each count is multiplied by the cumulative factor
     of splits after that date — the adjustment fetch_chart_data.py
     applies to EPS, because the price bars are split-adjusted. A
     ticker whose splits cannot be fetched keeps its previous
     series (or ships nothing) rather than an unadjusted one.

ADS names: TSM and PDD trade in the US as depositary shares while
EDGAR counts their home-market shares (TSM: 1 ADS = 5 ordinary
shares; PDD: 1 ADS = 4 ordinary shares — both stated in the
companies' own 20-F filings). Their counts are divided into ADS
terms so price x shares is the company's real market cap, and the
file says so in the series' unit note.

Non-companies never reach EDGAR: indexes, rates, crypto, commodities
and currencies have no shares to count, and the two preferred stocks
(STRC, SATS) are classes of a registrant whose EDGAR count is its
common stock — mapping them onto it would print another class's
count against their price. They ship with an honest kind instead.

Run by update-market.yml after fetch_chart_data.py (which refreshes
the universe file this reads). A systemic failure (EDGAR unreachable,
or most tickers failing) exits non-zero BEFORE the output is touched,
so the run goes red and yesterday's verified file stays live.
"""

import json
import os
import re
import sys
import time
from datetime import date, datetime, timezone

import requests

EDGAR_HEADERS = {"User-Agent": "Johnny ONeal johnny-website@muse.ai",
                 "Accept-Encoding": "gzip, deflate",
                 "Host": "data.sec.gov"}
ARCHIVES_HEADERS = {"User-Agent": "Johnny ONeal johnny-website@muse.ai"}
YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (onealjb93.github.io chart updater)"}
YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]

FIXED_KINDS = {
    "SPX": "index", "IXIC": "index", "RUT": "index", "DOW": "index",
    "VIX": "index",
    "TNX": "rate",
    "BTC": "crypto",
    "GOLD": "commodity", "SILVER": "commodity", "COPPER": "commodity",
    "OIL": "commodity", "BRENT": "commodity", "NATGAS": "commodity",
    "CORN": "commodity", "WHEAT": "commodity",
    "DOLLAR": "currency", "EURO": "currency",
    "STRC": "preferred", "SATS": "preferred",
}

# Traded as ADSs in the US; EDGAR counts home-market shares.
ADS_RATIO = {"TSM": 5.0, "PDD": 4.0}

ACCEPT_FORMS = {
    "10-K", "10-Q", "20-F", "40-F", "6-K", "8-K",
    "10-K/A", "10-Q/A", "20-F/A", "40-F/A", "6-K/A",
}
PERIODIC_FORMS = {
    "10-K", "10-Q", "20-F", "40-F",
    "10-K/A", "10-Q/A", "20-F/A", "40-F/A",
}

EARLIEST = "2009-01-01"
FALLBACK_EARLIEST = "2013-06-01"
# A quarterly filer's newest period end is never four months old;
# an annual filer's can be fifteen. 400 days separates "the concept
# data stopped" (ASST after its merger) from "files once a year".
STALE_DAYS = 400


def fetch_json(url, headers, tries=3):
    last = None
    for i in range(tries):
        try:
            resp = requests.get(url, headers=headers, timeout=40)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            last = exc
            time.sleep(1.5 * (i + 1))
    raise last


def fetch_text(url, headers, tries=2):
    last = None
    for i in range(tries):
        try:
            resp = requests.get(url, headers=headers, timeout=60)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.text
        except Exception as exc:
            last = exc
            time.sleep(1.5 * (i + 1))
    raise last


def fetch_cik_map():
    data = fetch_json("https://www.sec.gov/files/company_tickers.json",
                      ARCHIVES_HEADERS)
    out = {}
    for row in data.values():
        out[row["ticker"]] = str(row["cik_str"]).zfill(10)
    return out


# ---------- route 1: the concept API ----------

def fetch_concept(cik, taxonomy, concept):
    url = ("https://data.sec.gov/api/xbrl/companyconcept/CIK%s/%s/%s.json"
           % (cik, taxonomy, concept))
    data = fetch_json(url, EDGAR_HEADERS)
    if not data:
        return []
    units = (data.get("units") or {}).get("shares") or []
    rows = []
    for e in units:
        val = e.get("val")
        end = e.get("end")
        if not val or val <= 0 or not end or end < EARLIEST:
            continue
        form = (e.get("form") or "").strip()
        if form and form not in ACCEPT_FORMS:
            continue
        rows.append({"end": end, "val": float(val),
                     "filed": e.get("filed") or ""})
    return rows


def concept_steps(cik):
    dei = fetch_concept(cik, "dei", "EntityCommonStockSharesOutstanding")
    time.sleep(0.15)
    gaap = []
    earliest_dei = min((r["end"] for r in dei), default="9999")
    if len(dei) < 8 or earliest_dei > "2013-01-01":
        gaap = fetch_concept(cik, "us-gaap", "CommonStockSharesOutstanding")
        time.sleep(0.15)
    best = {}
    for src, rows in (("gaap", gaap), ("dei", dei)):
        for r in rows:
            cur = best.get(r["end"])
            if (cur is None or r["filed"] > cur[0]
                    or (r["filed"] == cur[0] and src == "dei")):
                best[r["end"]] = (r["filed"], r["val"])
    return {end: val for end, (_filed, val) in best.items()}


# ---------- route 2: the filings' instance documents ----------

FACT_RE = re.compile(
    r"<dei:EntityCommonStockSharesOutstanding\b[^>]*?"
    r"contextRef=\"([^\"]+)\"[^>]*?>([^<]+)</dei:EntityCommonStockSharesOutstanding>")
CONTEXT_RE = re.compile(r"<context id=\"([^\"]+)\">(.*?)</context>", re.S)
INSTANT_RE = re.compile(r"<instant>([^<]+)</instant>")
MEMBER_RE = re.compile(
    r'<xbrldi:explicitMember\s+dimension="[^"]*StatementClassOfStockAxis'
    r'[^"]*">([^<]+)</xbrldi:explicitMember>')


def parse_instance(text):
    """{instant: total shares} from one filing's XBRL instance.
    An undimensioned fact at an instant is the total; otherwise the
    class-dimensioned facts at that instant are summed (the dei
    concept is common stock only, so the classes are its parts)."""
    if "EntityCommonStockSharesOutstanding" not in text:
        return {}
    contexts = {}
    for cid, body in CONTEXT_RE.findall(text):
        m = INSTANT_RE.search(body)
        if not m:
            continue
        contexts[cid] = (m.group(1), MEMBER_RE.findall(body))
    by_instant = {}
    for cid, raw in FACT_RE.findall(text):
        if cid not in contexts:
            continue
        instant, members = contexts[cid]
        try:
            val = float(raw.replace(",", ""))
        except ValueError:
            continue
        if val <= 0:
            continue
        slot = by_instant.setdefault(instant, {"plains": set(), "summed": 0.0})
        if not members:
            slot["plains"].add(val)
        else:
            slot["summed"] += val
    out = {}
    for instant, slot in by_instant.items():
        if len(slot["plains"]) == 1:
            total = next(iter(slot["plains"]))
        elif slot["summed"] > 0:
            total = slot["summed"]
        elif slot["plains"]:
            # Several different undimensioned values at one instant
            # can only be class parts whose axis went unrecognized —
            # sum the distinct values rather than let one win.
            total = sum(slot["plains"])
        else:
            continue
        if total > 0:
            out[instant] = total
    return out


def filing_steps(cik, filed_after=None):
    """Cover counts read from the periodic filings themselves.
    With filed_after set, only filings filed after that date are
    read (the caller merges them into the raw steps it stored last
    run — a nightly run then reads a quarter's worth of filings,
    not a decade's). Returns ({instant: shares}, latest filed date
    seen among the filings read)."""
    sub = fetch_json("https://data.sec.gov/submissions/CIK%s.json" % cik,
                     EDGAR_HEADERS)
    if not sub:
        return {}, None
    filings = []  # (filingDate, accession, reportDate)

    def collect(recent):
        forms = recent.get("form") or []
        for i in range(len(forms)):
            if forms[i] in PERIODIC_FORMS:
                filings.append((recent["filingDate"][i],
                                recent["accessionNumber"][i],
                                recent["reportDate"][i]))

    collect(sub["filings"]["recent"])
    if not filed_after:
        for extra in (sub["filings"].get("files") or [])[:3]:
            if extra.get("filingTo", "") < FALLBACK_EARLIEST:
                break
            more = fetch_json("https://data.sec.gov/submissions/%s"
                              % extra["name"], EDGAR_HEADERS)
            time.sleep(0.12)
            if more:
                collect(more)
    filings = sorted({f for f in filings if f[2] >= FALLBACK_EARLIEST})
    if filed_after:
        filings = [f for f in filings if f[0] > filed_after]
    if not filings:
        return {}, None
    cik_int = str(int(cik))
    steps = {}
    latest_filed = filings[-1][0]
    # Per-ticker budget (the one-time full-history build may raise
    # it via DIL_BUDGET_S; nightly runs keep the default).
    deadline = time.time() + int(os.environ.get("DIL_BUDGET_S", "240"))
    # Newest first: if the budget ever cuts a harvest short, the
    # steps lost are the oldest ones — the windows the front end
    # can offer shrink honestly instead of the recent line going
    # silently stale.
    for _filed, accn, _rep in reversed(filings):
        if time.time() > deadline:
            print("filing route budget reached for CIK %s (%d steps kept)"
                  % (cik, len(steps)), file=sys.stderr)
            break
        acc = accn.replace("-", "")
        idx = fetch_json("https://www.sec.gov/Archives/edgar/data/%s/%s/index.json"
                         % (cik_int, acc), ARCHIVES_HEADERS)
        time.sleep(0.12)
        if not idx:
            continue
        names = [it["name"] for it in idx["directory"]["item"]
                 if it["name"].endswith(".xml")]
        cands = [n for n in names
                 if not any(s in n for s in ("_cal", "_def", "_lab", "_pre",
                                             "FilingSummary", "Financial_Report"))
                 and not re.fullmatch(r"R\d+\.xml", n)]
        cands.sort(key=lambda n: (0 if n.endswith("_htm.xml") else 1, n))
        for name in cands[:2]:
            text = fetch_text("https://www.sec.gov/Archives/edgar/data/%s/%s/%s"
                              % (cik_int, acc, name), ARCHIVES_HEADERS)
            time.sleep(0.12)
            if not text:
                continue
            found = parse_instance(text)
            if found:
                steps.update(found)
                break
    return steps, latest_filed


# ---------- splits ----------

def fetch_splits(symbol):
    """Yahoo split events: [(date_iso, factor)] oldest first.
    Mirrors fetch_chart_data.py's fetch_splits. Raises on failure."""
    last_exc = None
    for host in YAHOO_HOSTS:
        url = "https://%s/v8/finance/chart/%s" % (host, symbol)
        try:
            resp = requests.get(url,
                                params={"range": "max", "interval": "1mo",
                                        "events": "split"},
                                headers=YAHOO_HEADERS, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            last_exc = exc
            continue
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            err = (data.get("chart") or {}).get("error") or {}
            raise ValueError("no chart result: %s" % err)
        splits_map = (result[0].get("events") or {}).get("splits") or {}
        out = []
        for ts, ev in splits_map.items():
            num, den = ev.get("numerator"), ev.get("denominator")
            if not num or not den:
                continue
            stamp = ev.get("date") or int(ts)
            day = datetime.fromtimestamp(int(stamp),
                                         tz=timezone.utc).date()
            out.append((day.isoformat(), float(num) / float(den)))
        return sorted(out)
    raise last_exc if last_exc else ValueError("no host answered")


def split_factor_after(day, splits):
    factor = 1.0
    for split_date, split_factor in splits:
        if split_date > day:
            factor *= split_factor
    return factor


# ---------- assembly ----------

def build_ticker(ticker, cik, prev=None):
    raw = concept_steps(cik)
    filings_through = None
    if prev and prev.get("raw"):
        # Last run's filing-route harvest is the base the concept
        # API cannot supply; the fresh concept values overlay it,
        # and only filings newer than the stored watermark are read.
        merged = {end: float(val) for end, val in prev["raw"]}
        merged.update(raw)
        raw = merged
        filings_through = prev.get("filings_through")
    latest = max(raw) if raw else ""
    stale = (not latest
             or (date.today() - date.fromisoformat(latest)).days > STALE_DAYS)
    if len(raw) < 2 or stale:
        try:
            from_filings, seen_through = filing_steps(
                cik, filed_after=filings_through)
        except Exception as exc:
            print("filing route failed for %s: %s" % (ticker, exc),
                  file=sys.stderr)
            from_filings, seen_through = {}, None
        for end, val in from_filings.items():
            if end >= EARLIEST:
                raw[end] = val  # the filing itself outranks the API merge
        if seen_through:
            filings_through = seen_through
    if len(raw) < 2:
        return None
    splits = fetch_splits(ticker)
    ratio = ADS_RATIO.get(ticker, 1.0)
    out = []
    for end in sorted(raw):
        adj = raw[end] * split_factor_after(end, splits) / ratio
        out.append([end, int(round(adj))])
    dedup = []
    for row in out:
        if dedup and dedup[-1][1] == row[1]:
            continue
        dedup.append(row)
    if len(dedup) < 2:
        return None
    entry = {"kind": "equity", "cik": cik, "steps": dedup,
             "raw": [[end, int(round(raw[end]))] for end in sorted(raw)]}
    if filings_through:
        entry["filings_through"] = filings_through
    if ratio != 1.0:
        entry["unit"] = "ADS (1 ADS = %g ordinary shares)" % ratio
    return entry


def main():
    daily_path = sys.argv[1] if len(sys.argv) > 1 else "finance-chart-daily.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "dilution-data.json"
    with open(daily_path) as fh:
        daily = json.load(fh)
    universe = sorted((daily.get("series") or {}).keys())
    if not universe:
        print("no universe in %s" % daily_path, file=sys.stderr)
        return 1

    previous = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as fh:
                previous = (json.load(fh).get("series") or {})
        except Exception:
            previous = {}

    cik_map = fetch_cik_map()  # raises on a systemic EDGAR failure

    series = {}
    attempted = failed = 0
    for ticker in universe:
        kind = FIXED_KINDS.get(ticker)
        if kind:
            series[ticker] = {"kind": kind}
            continue
        cik = cik_map.get(ticker)
        if not cik:
            series[ticker] = {"kind": "nofiling"}
            continue
        attempted += 1
        print("building %s" % ticker, flush=True)
        try:
            entry = build_ticker(ticker, cik, prev=previous.get(ticker))
        except Exception as exc:
            print("FAIL %s: %s" % (ticker, exc), file=sys.stderr)
            entry = None
            failed += 1
        if entry:
            series[ticker] = entry
        elif ticker in previous and previous[ticker].get("kind") == "equity":
            series[ticker] = previous[ticker]
        else:
            series[ticker] = {"kind": "nofiling"}

    if attempted and failed > attempted * 0.3:
        print("systemic failure: %d of %d tickers failed"
              % (failed, attempted), file=sys.stderr)
        return 1

    payload = {
        "built": date.today().isoformat(),
        "source": ("Shares outstanding: SEC EDGAR filings — the "
                   "cover-page count (dei EntityCommonStockShares"
                   "Outstanding), with the balance-sheet count "
                   "(us-gaap CommonStockSharesOutstanding) and, for "
                   "multi-class filers whose counts the concept API "
                   "does not carry, the filings' own XBRL instance "
                   "documents with share classes summed. Period-end "
                   "values; latest filing wins per period; split-"
                   "adjusted with Yahoo Finance split events to the "
                   "price bars' basis."),
        "series": series,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    os.replace(tmp, out_path)
    equities = sum(1 for v in series.values() if v["kind"] == "equity")
    print("dilution-data.json: %d tickers, %d with share steps, "
          "%d failed tonight" % (len(series), equities, failed))
    return 0


if __name__ == "__main__":
    sys.exit(main())
