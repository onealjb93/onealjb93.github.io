"""Market context data for the Finance page — DATA ONLY.

Built by fetch_chart_data.py at the end of its run (the workflow
already runs that script; this module is imported lazily there so
a failure here can never touch the chart files). Writes
finance-context.json beside the chart files:

  breadth200  the share of the chart's own universe (every daily
              series except VIX) trading above its own trailing
              200-day average — computed from the run's own bars,
              no outside source.
  hy_oas      the ICE BofA US High Yield Index Option-Adjusted
              Spread (FRED series BAMLH0A0HYM2, percent), from
              FRED's free CSV endpoint, forward-filled onto the
              trading calendar.
  insiders    per-series insider-buying clusters from SEC EDGAR
              Form 4 filings: for each of the series' own bar
              dates, how many distinct insiders made an
              open-market purchase within the trailing 90 days,
              and the dates where that count reaches 3 (a
              cluster).

No signal reads any of this yet (2026-11-23). It exists so the
next indicator question — the research study of 2026-11-23
found the sell side's missing ingredients in exactly these
data — can be studied against real history instead of asserted.

Insider events are parsed from the filings themselves and
cached in insider-purchases.json (same directory), keyed by
CIK, so a later run fetches only newly filed forms; the cache
is a data file like the chart files and rides the same commit.
"""

import bisect
import json
import os
import time
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

import requests

CONTEXT_OUT_FILE = "finance-context.json"
INSIDER_CACHE_FILE = "insider-purchases.json"
SCHEMA = "finance-context/v1"

# The SEC's declared UA shape (a person's name + email), the same
# string fetch_chart_data.py already uses for EDGAR.
EDGAR_HEADERS = {"User-Agent": "Johnny O'Neal johnny-website@muse.ai",
                 "Accept": "application/json"}
EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
EDGAR_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK%s.json"
EDGAR_SUBMISSIONS_CHUNK_URL = "https://data.sec.gov/submissions/%s"
EDGAR_ARCHIVES_DOC_URL = ("https://www.sec.gov/Archives/edgar/data/"
                          "%d/%s/%s")
# SEC fair access: no more than 10 requests/second. The chart
# script sleeps 0.15s around its EDGAR calls; 0.12s here keeps
# this module under the same ceiling.
EDGAR_SLEEP = 0.12

# Form 4 ownership reports became mandatory EDGAR filings on
# 2003-06-30. Before that date there is nothing to parse.
INSIDER_FILED_SINCE = "2003-06-30"
CLUSTER_WINDOW_DAYS = 90
CLUSTER_MIN_BUYERS = 3
# Wall-clock budget for insider XML fetching inside one run.
# The first-ever build is a long pull (a large filer has filed
# thousands of Form 4s since 2003 — WMT 3,071, NVDA 1,404,
# counted 2026-11-23), and it must never endanger the run's
# commit: when the budget runs out, the filers not yet reached
# keep their cached events, the cache (with every filer that
# did finish) is written as usual, and the next run resumes
# where this one stopped. In steady state every filer has a
# watermark, only newly filed forms are fetched, and the
# budget is never approached.
INSIDER_RUN_BUDGET_S = 1200

FRED_HY_CSV_URL = ("https://fred.stlouisfed.org/graph/fredgraph.csv"
                   "?id=BAMLH0A0HYM2")

# Indexes, futures, FX and the VIX itself: no company, no
# insiders. Mirrors fetch_chart_data.py's BENCHMARK_KEYS (the
# benchmarks plus the band instruments) plus VIX.
NO_INSIDER_KEYS = {"SPX", "IXIC", "GOLD", "BTC", "VIX",
                   "DOW", "RUT", "TNX", "DOLLAR", "EURO", "SILVER",
                   "COPPER", "OIL", "BRENT", "NATGAS", "CORN",
                   "WHEAT"}


def _noop(msg):
    pass


def _get_json(session, url, log):
    """GET a JSON document from EDGAR, with retries: the SEC's
    endpoints occasionally answer slowly or with a transient
    429/5xx, and one slow response must not cost a whole filer
    its update. Backoff 1s, 2s, 4s; the fair-access sleep runs
    after every successful request."""
    last = None
    for attempt in range(4):
        try:
            resp = session.get(url, headers=EDGAR_HEADERS,
                               timeout=60)
            if resp.status_code in (429, 500, 502, 503, 504) \
                    and attempt < 3:
                raise requests.HTTPError(
                    "transient HTTP %d" % resp.status_code)
            resp.raise_for_status()
            time.sleep(EDGAR_SLEEP)
            return resp.json()
        except Exception as exc:
            last = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise last


def _get_text(session, url, log):
    """GET a filing document from the EDGAR archives, with the
    same retry/backoff discipline as _get_json."""
    last = None
    for attempt in range(4):
        try:
            resp = session.get(url, headers=EDGAR_HEADERS,
                               timeout=60)
            if resp.status_code in (429, 500, 502, 503, 504) \
                    and attempt < 3:
                raise requests.HTTPError(
                    "transient HTTP %d" % resp.status_code)
            resp.raise_for_status()
            time.sleep(EDGAR_SLEEP)
            return resp.text
        except Exception as exc:
            last = exc
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise last


# ------------------------------------------------------------- insiders

def load_ticker_cik(session, log=_noop):
    """{ticker: CIK as a zero-padded 10-digit string} from the
    SEC's own ticker map."""
    data = _get_json(session, EDGAR_TICKERS_URL, log)
    out = {}
    for row in data.values():
        out[row["ticker"]] = "%010d" % int(row["cik_str"])
    return out


def _cik_for_symbol(ticker_map, symbol):
    """The chart's symbols are Yahoo's; the SEC's map uses its
    own punctuation for share classes (BRK/B, BF/B). Try the
    plain symbol, then the separator swaps."""
    for cand in (symbol, symbol.replace("-", "/"),
                 symbol.replace(".", "/"), symbol.replace("-", ".")):
        if cand in ticker_map:
            return ticker_map[cand]
    return None


def _form4_filings(cik10, session, log, filed_since):
    """[(filed_date, accession, primary_document)] for every
    Form 4 in the filer's submissions feed (recent block plus
    the history chunk files), filed on/after filed_since."""
    out = []

    def take(block):
        forms = block.get("form") or []
        accs = block.get("accessionNumber") or []
        filed = block.get("filingDate") or []
        docs = block.get("primaryDocument") or []
        for i, form in enumerate(forms):
            if form == "4" and filed[i] >= filed_since:
                out.append((filed[i], accs[i], docs[i]))

    data = _get_json(session, EDGAR_SUBMISSIONS_URL % cik10, log)
    filings = data.get("filings") or {}
    take(filings.get("recent") or {})
    for chunk in filings.get("files") or []:
        name = chunk.get("name")
        if not name:
            continue
        # A history chunk entirely before the window cannot
        # hold a filing we need.
        if (chunk.get("filingTo") or "") < filed_since:
            continue
        take(_get_json(session, EDGAR_SUBMISSIONS_CHUNK_URL % name,
                       log) or {})
    out.sort()
    return out


def _xml_value(el):
    """Ownership-XML values sit in a <value> child half the time
    and as bare text the rest."""
    if el is None:
        return None
    v = el.find("value")
    if v is not None and v.text:
        return v.text.strip()
    return el.text.strip() if el.text else None


def parse_form4(xml_text):
    """Parse one Form 4 (EDGAR ownership XML).

    Returns (insider_id, insider_name, purchases, sales).
    purchases / sales are ISO transaction dates taken from the
    NON-derivative table only:

      purchase — transaction code P (open-market or private
                 purchase) with acquired/disposed code A.
      sale     — transaction code S (open-market or private
                 sale) with acquired/disposed code D.

    Only purchases are ever counted by the cluster builder;
    sales are returned so a caller (or a test) can prove they
    were seen and not counted. A filing with several reporting
    owners is attributed to its first owner (group filings are
    rare, and each owner normally files their own form).
    insider_id is the owner's CIK where the form carries one,
    else the owner's name."""
    root = ET.fromstring(xml_text)
    insider_id = insider_name = None
    owner = root.find("reportingOwner")
    if owner is not None:
        insider_name = _xml_value(
            owner.find("reportingOwnerId/rptOwnerName"))
        cik = _xml_value(owner.find("reportingOwnerId/rptOwnerCik"))
        insider_id = cik or insider_name
    purchases, sales = [], []
    table = root.find("nonDerivativeTable")
    if table is not None:
        for tx in table.findall("nonDerivativeTransaction"):
            code = _xml_value(
                tx.find("transactionCoding/transactionCode"))
            ad = _xml_value(tx.find(
                "transactionAmounts/transactionAcquiredDisposedCode"))
            when = _xml_value(tx.find("transactionDate"))
            if not when:
                continue
            if code == "P" and ad == "A":
                purchases.append(when)
            elif code == "S" and ad == "D":
                sales.append(when)
    return insider_id, insider_name, purchases, sales


def _archives_url(cik10, accession, doc):
    """The Archives URL of a filing's primary document. The
    submissions feed sometimes names the XSLT-RENDERED copy
    (xslF345X06/<file>.xml — an HTML page wearing an .xml
    name); the raw filing is the same file name at the
    accession root, so any directory prefix is dropped."""
    return EDGAR_ARCHIVES_DOC_URL % (
        int(cik10), accession.replace("-", ""), doc.rsplit("/", 1)[-1])


def _insider_events(cik10, cache_entry, session, log, filed_since,
                    deadline=None):
    """Merge one filer's Form 4 purchase events into its cache
    entry. Returns (events, filed_through, complete): events
    are [trade_date, insider_id, accession] lists, sorted;
    complete is False when the run's fetch budget stopped the
    pull early — filed_through then names the last filing
    actually processed, and the next run resumes from there
    (the 14-day overlap below makes the resume exact).

    The listing itself is cheap (the submissions feed); the
    XML fetches are the cost, so on a cached filer only
    filings made since the watermark (less a 14-day overlap
    for late or amended filings) are fetched, and events
    de-duplicate on (accession, insider, date). A filing that
    fails to fetch or parse is logged and skipped — one bad
    form never blocks a filer."""
    events = [list(e) for e in (cache_entry or {}).get("events") or []]
    seen = {(e[2], e[1], e[0]) for e in events}
    watermark = (cache_entry or {}).get("filed_through")
    filings = _form4_filings(cik10, session, log, filed_since)
    if watermark:
        overlap = (date.fromisoformat(watermark).toordinal() - 14)
        fetch_from = date.fromordinal(overlap).isoformat()
    else:
        fetch_from = filed_since
    fetched = skipped = 0
    last_processed = None
    complete = True
    for filed, accession, doc in filings:
        if filed < fetch_from or not doc:
            continue
        if deadline is not None and time.monotonic() > deadline:
            complete = False
            break
        try:
            insider_id, _name, purchases, _sales = parse_form4(
                _get_text(session,
                          _archives_url(cik10, accession, doc), log))
        except Exception as exc:
            skipped += 1
            log("  insiders %s: filing %s skipped (%s)"
                % (cik10, accession, exc))
            last_processed = filed
            continue
        fetched += 1
        last_processed = filed
        if not insider_id:
            continue
        for when in purchases:
            item = [when, insider_id, accession]
            key = (accession, insider_id, when)
            if key not in seen:
                seen.add(key)
                events.append(item)
    events.sort()
    filed_through = watermark or ""
    if complete and filings:
        filed_through = max(filed_through, filings[-1][0])
    elif last_processed:
        filed_through = max(filed_through, last_processed)
    if fetched or skipped:
        log("  insiders %s: %d Form 4 filings parsed, %d "
            "skipped, %d purchase events on record%s"
            % (cik10, fetched, skipped, len(events),
               "" if complete else " (budget stop — resumes "
               "next run)"))
    return events, filed_through, complete


def buyers90_series(bar_dates, events):
    """For each bar date, the number of distinct insiders with
    at least one open-market purchase in the trailing 90
    calendar days, (date - 90, date]. Returns (buyers90,
    cluster_days): buyers90 is the sparse list of [date, count]
    for the dates with count >= 1; cluster_days are the dates
    whose count reaches CLUSTER_MIN_BUYERS — the cluster flag."""
    ev = sorted((date.fromisoformat(d).toordinal(), insider)
                for d, insider, _acc in events)
    ev_ords = [o for o, _ins in ev]
    buyers90, cluster_days = [], []
    for dstr in bar_dates:
        o = date.fromisoformat(dstr).toordinal()
        lo = bisect.bisect_right(ev_ords, o - CLUSTER_WINDOW_DAYS)
        hi = bisect.bisect_right(ev_ords, o)
        n = len({ins for _o, ins in ev[lo:hi]})
        if n >= 1:
            buyers90.append([dstr, n])
        if n >= CLUSTER_MIN_BUYERS:
            cluster_days.append(dstr)
    return buyers90, cluster_days


# ------------------------------------------------------------- breadth

def compute_breadth(d_series):
    """(dates, share): for every date in the union of the
    universe's bar dates, the share of series — every daily
    series except VIX — whose close that day is above the
    trailing 200-day average of its own closes. A series votes
    only on a day it has a bar and at least 200 bars of its own
    history; share is None until some series can vote."""
    votes = {}
    calendar = set()
    for key, entry in d_series.items():
        if key == "VIX":
            continue
        bars = entry.get("bars") or []
        closes = [float(b[4]) for b in bars]
        run = 0.0
        for i, bar in enumerate(bars):
            d = bar[0]
            calendar.add(d)
            run += closes[i]
            if i >= 200:
                run -= closes[i - 200]
            if i >= 199:
                slot = votes.setdefault(d, [0, 0])
                slot[1] += 1
                if closes[i] > run / 200.0:
                    slot[0] += 1
    dates = sorted(calendar)
    share = []
    for d in dates:
        above, defined = votes.get(d, [0, 0])
        share.append(round(above / defined, 4) if defined else None)
    return dates, share


# ------------------------------------------------------------- credit

def fetch_hy_oas(session, log=_noop):
    """[(date, value_pct)] for FRED series BAMLH0A0HYM2 from
    FRED's free CSV endpoint, oldest first, missing-value rows
    ('.') dropped.

    NOTE (verified 2026-11-23): the endpoint currently serves
    only the trailing ~3 years of daily observations — its
    cosd/coed parameters are ignored. This function takes
    whatever range FRED serves; coverage extends on its own if
    FRED restores full history."""
    resp = session.get(FRED_HY_CSV_URL, timeout=60,
                       headers={"User-Agent":
                                "Johnny O'Neal johnny-website@muse.ai"})
    resp.raise_for_status()
    obs = []
    for line in resp.text.splitlines()[1:]:
        parts = line.split(",")
        if len(parts) != 2:
            continue
        d, v = parts[0].strip(), parts[1].strip()
        if v in ("", "."):
            continue
        obs.append((d, float(v)))
    obs.sort()
    return obs


def forward_fill(obs, dates):
    """Align observations to the given calendar: each date
    takes the last observation on or before it (the spread
    publishes on business days, so weekends and holidays carry
    the last published value — a carried value is always a real
    observation, never an interpolation). Dates before the
    first observation are omitted."""
    obs_ords = [date.fromisoformat(d).toordinal() for d, _v in obs]
    out_dates, out_vals = [], []
    for d in dates:
        k = bisect.bisect_right(
            obs_ords, date.fromisoformat(d).toordinal()) - 1
        if k >= 0:
            out_dates.append(d)
            out_vals.append(obs[k][1])
    return out_dates, out_vals


# ------------------------------------------------------------- build

def build_context_file(d_series, out_dir, log=_noop, session=None,
                       insider_filed_since=None):
    """Write finance-context.json (and the insider cache) into
    out_dir from this run's daily series. Sections fail
    independently: a FRED failure ships hy_oas as null, an
    EDGAR failure for one filer leaves that filer's cached
    events standing, and nothing here raises into the caller
    for a single section's sake — the caller still wraps the
    whole build in its own guard."""
    session = session or requests.Session()
    filed_since = insider_filed_since or INSIDER_FILED_SINCE
    today = datetime.now(timezone.utc).date().isoformat()

    dates, share = compute_breadth(d_series)
    through = dates[-1] if dates else None

    hy_oas = None
    try:
        obs = fetch_hy_oas(session, log)
        hd, hv = forward_fill(obs, dates)
        hy_oas = {"dates": hd, "pct": hv}
        log("  context: high-yield spread, %d observations served "
            "by FRED (%s .. %s), %d calendar days filled"
            % (len(obs), obs[0][0] if obs else "—",
               obs[-1][0] if obs else "—", len(hd)))
    except Exception as exc:
        log("  context: high-yield spread FAILED (%s) — hy_oas "
            "ships as null this run" % exc)

    # --- insiders: cache first, then EDGAR for what is new ---
    cache_path = os.path.join(out_dir, INSIDER_CACHE_FILE)
    cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path) as fh:
                cache = json.load(fh) or {}
        except Exception as exc:
            log("  context: insider cache unreadable (%s) — "
                "treating as empty (a full re-pull follows)" % exc)
            cache = {}
    ticker_map = {}
    try:
        ticker_map = load_ticker_cik(session, log)
    except Exception as exc:
        log("  context: EDGAR ticker map FAILED (%s) — insiders "
            "limited to CIKs already in the cache" % exc)
        for cik10, entry in cache.items():
            for sym in (entry or {}).get("symbols") or []:
                ticker_map[sym] = cik10

    insiders = {}
    cache_dirty = False
    deadline = time.monotonic() + INSIDER_RUN_BUDGET_S
    deferred = False
    for key in sorted(d_series):
        if key in NO_INSIDER_KEYS:
            continue
        entry = d_series[key]
        symbol = entry.get("symbol")
        bars = entry.get("bars") or []
        if not symbol or not bars:
            continue
        cik10 = _cik_for_symbol(ticker_map, symbol)
        if not cik10:
            log("  context: no SEC CIK for %s (%s) — no insider "
                "series" % (key, symbol))
            continue
        cache_entry = cache.get(cik10) or {}
        events = [list(e) for e in cache_entry.get("events") or []]
        if deferred or time.monotonic() > deadline:
            if not deferred:
                deferred = True
                log("  context: insider fetch budget reached — "
                    "the remaining filers keep their cached "
                    "events and resume next run")
        else:
            try:
                events, filed_through, complete = _insider_events(
                    cik10, cache_entry, session, log, filed_since,
                    deadline=deadline)
                symbols = sorted(
                    set(cache_entry.get("symbols") or []) | {symbol})
                cache[cik10] = {"symbols": symbols,
                                "filed_through": filed_through,
                                "events": events}
                cache_dirty = True
                if not complete:
                    deferred = True
            except Exception as exc:
                log("  context: insider pull FAILED for %s (%s) — "
                    "cached events stand (%d)"
                    % (key, exc, len(events)))
        buyers90, cluster_days = buyers90_series(
            [b[0] for b in bars], events)
        insiders[key] = {"cik": cik10, "buyers90": buyers90,
                         "cluster_days": cluster_days}
    log("  context: insider series for %d of the chart's series"
        % len(insiders))

    if cache_dirty:
        tmp = cache_path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(cache, fh, separators=(",", ":"))
        os.replace(tmp, cache_path)

    doc = {
        "schema": SCHEMA,
        "generated": today,
        "through": through,
        "notes": {
            "about": "Market context for the Finance page, built "
                     "by market_context.py at the end of "
                     "fetch_chart_data.py's run. DATA ONLY — "
                     "Johnny's indicator does not read any of "
                     "it yet (2026-11-23).",
            "breadth200": "For each date, the share of the "
                          "chart's series (every series in "
                          "finance-chart-daily.json except VIX) "
                          "whose close that day is above the "
                          "trailing 200-day average of its own "
                          "closes. A series votes only on days "
                          "it has a bar and at least 200 bars of "
                          "history; share is null until some "
                          "series can vote. Computed from this "
                          "run's own daily bars; no outside "
                          "source.",
            "hy_oas": "ICE BofA US High Yield Index "
                      "Option-Adjusted Spread, in percent: "
                      "FRED series BAMLH0A0HYM2, fetched from "
                      "FRED's free CSV endpoint (fredgraph.csv). "
                      "Forward-filled onto the context calendar "
                      "(the union of the chart series' bar "
                      "dates): a weekend or holiday carries the "
                      "last published value, which is always a "
                      "real observation, never an interpolation. "
                      "Dates before the first observation FRED "
                      "serves are omitted. As of 2026-11-23 the "
                      "endpoint serves only the trailing ~3 "
                      "years of daily observations (its cosd/"
                      "coed parameters are ignored), so coverage "
                      "begins 2023-11-21; it extends on its own "
                      "if FRED restores full history — the code "
                      "requests the series, not a window.",
            "insiders": "Per chart series with an SEC CIK: "
                        "open-market insider purchases from "
                        "Form 4 filings — non-derivative "
                        "transactions, code P, acquired (sales "
                        "never count). buyers90 lists [date, n] "
                        "for each of the series' own bar dates "
                        "where n >= 1 distinct insiders bought "
                        "within the trailing 90 calendar days, "
                        "(date - 90, date]; cluster_days are the "
                        "bar dates where n >= 3 — the cluster "
                        "flag. Parsed from the filings "
                        "themselves and cached in "
                        "insider-purchases.json, so later runs "
                        "fetch only newly filed forms. Form 4 "
                        "is electronic only from 2003-06-30; no "
                        "earlier date can appear.",
        },
        "breadth200": {"dates": dates, "share": share},
        "hy_oas": hy_oas,
        "insiders": insiders,
    }
    out_path = os.path.join(out_dir, CONTEXT_OUT_FILE)
    tmp = out_path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    os.replace(tmp, out_path)
    log("Wrote %s (through %s)." % (out_path, through))
    return doc
