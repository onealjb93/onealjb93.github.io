"""Fetch weekly OHLCV bars from the Yahoo Finance v8 chart API.

One file, one purpose: build finance-chart-data.json for The Chart on
finance.html — the page's own chart (amber 200-week / blue 50-week /
violet weekly RSI), which replaced the TradingView embed on 2026-11-16
because the free widget cannot colour or thicken its two moving
averages separately (its overrides are keyed per study type, and both
averages are the same type).

Instruments: the S&P 500 (^GSPC), the Nasdaq Composite (^IXIC),
gold futures (GC=F), Bitcoin (BTC-USD), the VIX (^VIX), and Johnny's 19 scoreboard
stocks — plus, since 2026-11-16, every Nasdaq-100 constituent not
already in that set (NASDAQ100 below), carried CHART-ONLY for the
chart's second dropdown: their series are flagged "ndx" in the output
and the full constituent ticker list is written as "nasdaq100", so the
page can keep them out of the scoreboard, the Stack runner and the
backtest. Constituents already among the 19 keep their original
series (one series per ticker). Bars are weekly, as deep as Yahoo honestly serves (period from
2000-01-01), and each bar is dated by the Friday of its week — Yahoo
timestamps weekly bars inconsistently (some by the week's Monday, some
by its Friday, TSM occasionally by Saturday), so the Friday label is
the one convention that means the same week for every instrument.

Only completed weeks are kept: the still-forming current week's bar is
dropped, so the file's through-date is always the last finished Friday
(a Friday-evening run at/after 21:00 UTC keeps that day's bar).

Honesty rules (same as fetch_history.py / update_finance.py):
- No key, no Alpha Vantage calls: Yahoo's chart API is keyless, so the
  weekday AV budget is untouched.
- A failed instrument keeps its previous series from the existing
  finance-chart-data.json rather than vanishing. If an instrument has
  neither a fresh fetch nor a previous series, the run fails and the
  previous file is left untouched — a degraded file is never written.
- Bars with no close are skipped; a missing open/high/low falls back
  to that bar's close; a missing volume is 0 (the chart hides the
  volume pane for an instrument whose bars carry no real volume).

P/E history (added 2026-11-16; split fix 2026-11-16): each stock
series also gains a "pe" array aligned 1:1 with its bars — the week's
close divided by trailing-twelve-month diluted EPS from SEC EDGAR
companyfacts (us-gaap EarningsPerShareDiluted, USD/shares). The TTM
is point-in-time: a quarter counts only once its first filing was
public (its earliest `filed` date), so no week uses earnings
reported after it. Each quarter's VALUE comes from its ORIGINAL
filing, divided by the cumulative factor of the stock's splits that
occurred after that filing date (Yahoo split events). That
adjustment is not optional: Yahoo's closes are split-adjusted, so
an as-reported pre-split EPS divides into them wrongly — before
this fix, NVIDIA's full-history median P/E read 1.28. The
original-filing basis is the same one the scoreboard's EPS history
uses (update_finance.py): a filing's figures already reflect every
split on or before its filing date, so only later splits divide.
Q4 is derived where no standalone Q4 fact exists: the fiscal-year
annual minus the three standalone quarters inside that year, all on
the same adjusted basis. Annual-only filers (20-F) use the latest
filed annual EPS as the TTM — coarse, but honest. A week whose TTM
EPS is zero, negative or not yet knowable gets null: the chart's
P/E line breaks there rather than drawing a negative or invented
multiple. Benchmarks (index, gold, Bitcoin) get no pe — they have
no EPS. TSM is excluded by rule: its reported per-share basis (TWD
per ordinary share) does not match the listed ADR price. Any EDGAR
or split-history failure leaves the series without fresh pe (the
previous file's pe is carried over when the old bars are a strict
prefix of the new ones) — it never blocks or degrades the price
data.

Daily file (added 2026-11-16; full history since 2026-11-20): the
same run also writes finance-chart-daily.json — the same
instruments as DAILY bars over the same full history as the weekly
file (from 2000-01-01, or the instrument's own first trading day
where that is later), so the chart's Daily view can draw the same
gauges in their daily forms (200-day / 50-day averages, daily RSI,
20-day volume average) on every range the chart offers. (The daily
file originally carried only the last five years, which capped the
Daily view at the 5Y range; the window was widened to match the
weekly file's.) The page fetches it lazily, only when a
visitor first switches to Daily, so the weekly file stays the
page's normal load. Same honesty rules: only completed days (a day
counts once it is past, or once it is 21:00 UTC or later that day —
after the US close), bars with no close skipped, a failed instrument
keeps its previous daily series, and an instrument with neither
fresh nor previous daily data fails the daily write (the weekly
file, written first, is never held hostage to it). P/E arrays are
computed exactly as the weekly ones — the same point-in-time EDGAR
EPS timeline — at daily granularity: each day's close divided by
the TTM EPS knowable that day. Benchmarks get none; TSM stays
excluded by the same rule.

Indicator signals (added 2026-11-22): each daily series also gains
"buy" / "sell" arrays of ISO dates — Johnny's indicator, computed
from the daily bars, the P/E array and the VIX series in this same
run (see compute_indicator_signals below for the exact formula).
Benchmarks (SPX, IXIC, GOLD, BTC) have no earnings and no P/E, so
their signals use the remaining conditions; the VIX is an input,
never a target. Signals are a pure function of the bars and P/E
already in the file, recomputed in full each run — history never
repaints beyond what the underlying bars and P/E themselves do.
"""

import bisect
import json
import os
import sys
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone

import requests

# (page key, Yahoo symbol, display name)
INSTRUMENTS = [
    ("SPX", "^GSPC", "S&P 500"),
    ("IXIC", "^IXIC", "Nasdaq Composite"),
    ("GOLD", "GC=F", "Gold"),
    ("BTC", "BTC-USD", "Bitcoin"),
    ("VIX", "^VIX", "VIX"),
    ("GOOGL", "GOOGL", "Alphabet / Google"),
    ("ASST", "ASST", "Strive (Asset Series)"),
    ("CIFR", "CIFR", "Cipher Mining"),
    ("SPCX", "SPCX", "SpaceX"),
    ("NBIS", "NBIS", "Nebius Group"),
    ("IREN", "IREN", "Iris Energy"),
    ("AAOI", "AAOI", "Applied Optoelectronics"),
    ("NVDA", "NVDA", "NVIDIA"),
    ("AMD", "AMD", "AMD"),
    ("PLTR", "PLTR", "Palantir"),
    ("MU", "MU", "Micron Technology"),
    ("TSLA", "TSLA", "Tesla"),
    ("MSTR", "MSTR", "MicroStrategy / Strategy"),
    ("TSM", "TSM", "Taiwan Semiconductor"),
    ("LLY", "LLY", "Eli Lilly"),
    ("WM", "WM", "Waste Management"),
    ("COST", "COST", "Costco"),
    ("JPM", "JPM", "JPMorgan Chase"),
    ("WMT", "WMT", "Walmart"),
]

# The Nasdaq-100 constituents (ticker, display name) — Wikipedia's
# "List of NASDAQ-100 companies", as of 2026-10-22: 101 securities
# from 100 companies (Alphabet sits in the index twice, Class A and
# Class C). Eleven are already in INSTRUMENTS above (GOOGL, SPCX,
# NBIS, NVDA, AMD, PLTR, MU, TSLA, MSTR, COST, WMT) and keep their
# original series and names; the other 90 are appended as chart-only
# instruments whose page key is the ticker itself. When the index's
# membership changes (a December reconstitution, a mid-year swap),
# update this list: a dropped name simply stops being refreshed and
# leaves both dropdowns, a new name joins on the next run.
NASDAQ100 = [
    ("AAPL", "Apple"),
    ("ABNB", "Airbnb"),
    ("ADBE", "Adobe"),
    ("ADI", "Analog Devices"),
    ("ADP", "Automatic Data Processing"),
    ("ADSK", "Autodesk"),
    ("AEP", "American Electric Power"),
    ("ALAB", "Astera Labs"),
    ("ALNY", "Alnylam Pharmaceuticals"),
    ("AMAT", "Applied Materials"),
    ("AMD", "AMD"),
    ("AMGN", "Amgen"),
    ("AMZN", "Amazon"),
    ("APP", "AppLovin"),
    ("ARM", "Arm Holdings"),
    ("ASML", "ASML Holding"),
    ("AVGO", "Broadcom"),
    ("AXON", "Axon Enterprise"),
    ("BKNG", "Booking Holdings"),
    ("BKR", "Baker Hughes"),
    ("CCEP", "Coca-Cola Europacific Partners"),
    ("CDNS", "Cadence Design Systems"),
    ("CEG", "Constellation Energy"),
    ("CMCSA", "Comcast"),
    ("COST", "Costco"),
    ("CPRT", "Copart"),
    ("CRWD", "CrowdStrike"),
    ("CRWV", "CoreWeave"),
    ("CSCO", "Cisco"),
    ("CSX", "CSX"),
    ("CTAS", "Cintas"),
    ("DASH", "DoorDash"),
    ("DDOG", "Datadog"),
    ("DXCM", "DexCom"),
    ("EXC", "Exelon"),
    ("FANG", "Diamondback Energy"),
    ("FAST", "Fastenal"),
    ("FER", "Ferrovial"),
    ("FTNT", "Fortinet"),
    ("GEHC", "GE HealthCare"),
    ("GILD", "Gilead Sciences"),
    ("GOOG", "Alphabet Inc. (Class C)"),
    ("GOOGL", "Alphabet / Google"),
    ("HON", "Honeywell Technologies"),
    ("HONA", "Honeywell Aerospace"),
    ("IDXX", "Idexx Laboratories"),
    ("INTC", "Intel"),
    ("INTU", "Intuit"),
    ("ISRG", "Intuitive Surgical"),
    ("KDP", "Keurig Dr Pepper"),
    ("KLAC", "KLA"),
    ("LIN", "Linde"),
    ("LITE", "Lumentum"),
    ("LRCX", "Lam Research"),
    ("MAR", "Marriott International"),
    ("MCHP", "Microchip Technology"),
    ("MDLZ", "Mondelez International"),
    ("MELI", "Mercado Libre"),
    ("META", "Meta Platforms"),
    ("MNST", "Monster Beverage"),
    ("MPWR", "Monolithic Power Systems"),
    ("MRNA", "Moderna"),
    ("MRVL", "Marvell Technology"),
    ("MSFT", "Microsoft"),
    ("MSTR", "MicroStrategy / Strategy"),
    ("MU", "Micron Technology"),
    ("NBIS", "Nebius Group"),
    ("NFLX", "Netflix"),
    ("NVDA", "NVIDIA"),
    ("NXPI", "NXP Semiconductors"),
    ("ODFL", "Old Dominion Freight Line"),
    ("ORLY", "O'Reilly Automotive"),
    ("PANW", "Palo Alto Networks"),
    ("PAYX", "Paychex"),
    ("PCAR", "Paccar"),
    ("PDD", "PDD Holdings"),
    ("PEP", "PepsiCo"),
    ("PLTR", "Palantir"),
    ("PYPL", "PayPal"),
    ("QCOM", "Qualcomm"),
    ("REGN", "Regeneron Pharmaceuticals"),
    ("RKLB", "Rocket Lab"),
    ("ROP", "Roper Technologies"),
    ("ROST", "Ross Stores"),
    ("SBUX", "Starbucks"),
    ("SHOP", "Shopify"),
    ("SNDK", "Sandisk"),
    ("SNPS", "Synopsys"),
    ("SPCX", "SpaceX"),
    ("STX", "Seagate Technology"),
    ("TER", "Teradyne"),
    ("TMUS", "T-Mobile US"),
    ("TRI", "Thomson Reuters"),
    ("TSLA", "Tesla"),
    ("TTWO", "Take-Two Interactive"),
    ("TXN", "Texas Instruments"),
    ("VRTX", "Vertex Pharmaceuticals"),
    ("WDAY", "Workday"),
    ("WDC", "Western Digital"),
    ("WMT", "Walmart"),
    ("XEL", "Xcel Energy"),
]

_BASE_KEYS = {key for key, _symbol, _name in INSTRUMENTS}
# Chart-only instruments: Nasdaq-100 names not already carried above.
NDX_INSTRUMENTS = [(ticker, ticker, name) for ticker, name in NASDAQ100
                   if ticker not in _BASE_KEYS]
NDX_ONLY_KEYS = {key for key, _symbol, _name in NDX_INSTRUMENTS}
ALL_INSTRUMENTS = INSTRUMENTS + NDX_INSTRUMENTS

OUT_FILE = "finance-chart-data.json"
DAILY_OUT_FILE = "finance-chart-daily.json"
HEADERS = {"User-Agent": "Mozilla/5.0 (onealjb93.github.io chart updater)"}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
START = date(2000, 1, 1)

# --- P/E from SEC EDGAR (see the module docstring) ---
# The SEC's declared UA shape is a person's name + email; the old
# domain-first UA was 403'd as an undeclared automated tool (proven
# 2026-11-16 in the fundamentals pipeline fix).
EDGAR_HEADERS = {"User-Agent": "Johnny O'Neal johnny-website@muse.ai",
                 "Accept": "application/json"}
EDGAR_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
EDGAR_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK%s.json"
BENCHMARK_KEYS = {"SPX", "IXIC", "GOLD", "BTC", "VIX"}  # no EPS exists
PE_EXCLUDE = {"TSM"}  # reported per-share basis != listed ADR price


def log(msg):
    print(msg, flush=True)


def week_friday(d):
    """The Friday of the week a Yahoo weekly bar belongs to.

    Yahoo timestamps a weekly bar at the START of its week, but not on
    a consistent day: most series use Monday, the indexes and several
    stocks use the Saturday before (Sat 2026-11-07 carries the week
    ending Fri 2026-11-13 — verified against daily bars). The Friday
    is therefore the next Friday on or after the timestamp, never the
    one before it: (4 - weekday) mod 7 days ahead.
    """
    return d + timedelta(days=(4 - d.weekday()) % 7)


def last_completed_friday(today, now_utc):
    """Most recent Friday whose trading week is finished.

    A Friday counts once it is past, or — for an evening workflow run —
    once it is 21:00 UTC or later that day (after the US close).
    """
    this_fri = week_friday(today)
    if this_fri < today:
        return this_fri
    if this_fri == today and now_utc.hour >= 21:
        return today
    return this_fri - timedelta(days=7)


def fetch_yahoo(symbol, period1, period2):
    """Weekly OHLCV bars: list of [friday_iso, o, h, l, c, v], oldest first."""
    last_exc = None
    for host in HOSTS:
        url = "https://%s/v8/finance/chart/%s" % (host, symbol)
        try:
            resp = requests.get(
                url,
                params={"period1": period1, "period2": period2,
                        "interval": "1wk", "events": "div,split"},
                headers=HEADERS,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # try the mirror host before giving up
            last_exc = exc
            continue
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            err = (data.get("chart") or {}).get("error") or {}
            raise ValueError("no chart result: %s" % err)
        quote = result[0].get("indicators", {}).get("quote", [{}])[0]
        stamps = result[0].get("timestamp") or []
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        vols = quote.get("volume") or []
        by_friday = {}
        for i, ts in enumerate(stamps):
            close = closes[i] if i < len(closes) else None
            if close is None or close <= 0:
                continue  # no close, no bar (the forming week lands here)
            def num(arr):
                v = arr[i] if i < len(arr) else None
                return float(v) if v is not None else float(close)
            d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
            fri = week_friday(d).isoformat()
            vol = vols[i] if i < len(vols) and vols[i] is not None else 0
            by_friday[fri] = [fri, round(num(opens), 4), round(num(highs), 4),
                              round(num(lows), 4), round(float(close), 4),
                              int(vol)]
        return [by_friday[k] for k in sorted(by_friday)]
    raise last_exc if last_exc else ValueError("no host answered")


def last_completed_day(today, now_utc):
    """Most recent day whose trading is finished.

    A day counts once it is past, or — for an evening workflow run —
    once it is 21:00 UTC or later that day (after the US close). The
    daily analogue of last_completed_friday above.
    """
    if now_utc.hour >= 21:
        return today
    return today - timedelta(days=1)


def years_ago(d, years):
    """The same calendar date `years` earlier (Feb 29 -> Feb 28)."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:
        return d.replace(year=d.year - years, day=28)


def fetch_yahoo_daily(symbol, period1, period2):
    """Daily OHLCV bars: list of [iso_date, o, h, l, c, v], oldest first.

    Yahoo timestamps a daily bar on its trading day (midnight or the
    open in exchange time — both land on the same UTC date for the
    US-listed instruments this pipeline carries), so the bar's own
    date needs no Friday mapping. Bars with no close are skipped;
    a missing open/high/low falls back to that bar's close; a
    missing volume is 0 — the same conventions as the weekly fetch.
    """
    last_exc = None
    for host in HOSTS:
        url = "https://%s/v8/finance/chart/%s" % (host, symbol)
        try:
            resp = requests.get(
                url,
                params={"period1": period1, "period2": period2,
                        "interval": "1d", "events": "div,split"},
                headers=HEADERS,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # try the mirror host before giving up
            last_exc = exc
            continue
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            err = (data.get("chart") or {}).get("error") or {}
            raise ValueError("no chart result: %s" % err)
        quote = result[0].get("indicators", {}).get("quote", [{}])[0]
        stamps = result[0].get("timestamp") or []
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        vols = quote.get("volume") or []
        by_date = {}
        for i, ts in enumerate(stamps):
            close = closes[i] if i < len(closes) else None
            if close is None or close <= 0:
                continue  # no close, no bar (a still-forming day lands here on some symbols)
            def num(arr):
                v = arr[i] if i < len(arr) else None
                return float(v) if v is not None else float(close)
            d = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
            vol = vols[i] if i < len(vols) and vols[i] is not None else 0
            by_date[d] = [d, round(num(opens), 4), round(num(highs), 4),
                          round(num(lows), 4), round(float(close), 4),
                          int(vol)]
        return [by_date[k] for k in sorted(by_date)]
    raise last_exc if last_exc else ValueError("no host answered")


def fetch_edgar_json(url):
    resp = requests.get(url, headers=EDGAR_HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.json()


def load_cik_map():
    """ticker -> zero-padded CIK, from the SEC's own ticker file."""
    data = fetch_edgar_json(EDGAR_TICKERS_URL)
    out = {}
    for row in data.values():
        out[row["ticker"]] = str(row["cik_str"]).zfill(10)
    return out


def fetch_splits(symbol):
    """Split events for a ticker from Yahoo's v8 chart API:
    [(date_iso, factor)] oldest first, factor = numerator/denominator
    (10 for a 10:1 split). Each event's own `date` is the split day;
    the map key is only the monthly bar's timestamp, so it is used
    only when an event carries no date. Raises on any failure — the
    caller treats that as 'unknown' and ships no fresh P/E rather
    than an unadjusted one."""
    last_exc = None
    for host in HOSTS:
        url = "https://%s/v8/finance/chart/%s" % (host, symbol)
        try:
            resp = requests.get(
                url,
                params={"range": "max", "interval": "1mo",
                        "events": "split"},
                headers=HEADERS,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:  # try the mirror host before giving up
            last_exc = exc
            continue
        result = (data.get("chart") or {}).get("result") or []
        if not result:
            err = (data.get("chart") or {}).get("error") or {}
            raise ValueError("no chart result: %s" % err)
        splits_map = (result[0].get("events") or {}).get("splits") or {}
        out = []
        for ts, ev in splits_map.items():
            num = ev.get("numerator")
            den = ev.get("denominator")
            if not num or not den:
                continue
            stamp = ev.get("date") or int(ts)
            day = datetime.fromtimestamp(int(stamp),
                                         tz=timezone.utc).date()
            out.append((day.isoformat(), float(num) / float(den)))
        return sorted(out)
    raise last_exc if last_exc else ValueError("no host answered")


def split_factor_after(day, splits):
    """Cumulative split factor for splits strictly after `day`.
    splits: [(date_iso, factor)] with factor = numerator/denominator.
    (Same helper as update_finance.py's scoreboard block.)"""
    factor = 1.0
    for split_date, split_factor in splits:
        if split_date > day:
            factor *= split_factor
    return factor


def _pick_original(rows_at_end):
    """The figure from the ORIGINAL filing for one period end.

    companyfacts carries several rows per period end: the original
    filing's figure and later filings' restated comparatives. The
    original filing is the earliest `filed` at the end; within it,
    the value repeated most often across all filings at that end
    wins, then the largest magnitude. Returns (val, filed).
    (Mirrors update_finance.py's scoreboard helper.)
    """
    from collections import Counter
    earliest = min(e.get("filed", "") for e in rows_at_end)
    group = [e for e in rows_at_end if e.get("filed", "") == earliest]
    if len({e["val"] for e in group}) == 1:
        return group[0]["val"], earliest
    counts = Counter(e["val"] for e in rows_at_end)
    best = max(group, key=lambda e: (counts[e["val"]], abs(e["val"])))
    return best["val"], earliest


def build_eps_periods(facts, splits):
    """Split EPS facts into standalone quarters and annuals.

    A standalone quarter spans 70-110 days, an annual 330-380; the
    6/9-month year-to-date facts income statements also carry fall
    between those bands and are ignored. Per period end, the value
    is the ORIGINAL filing's figure (see _pick_original), divided by
    the splits that occurred after that filing — Yahoo's closes are
    split-adjusted, so each period's EPS must be brought onto the
    same basis before it can divide into them. `avail` is the
    original filing date (the first day the period was public). Q4
    is then derived for every annual whose three inner quarters are
    known: annual minus their sum (all on the adjusted basis),
    public from the annual's first filing. When `splits` is None
    the caller does not call this at all — unadjusted history is
    never shipped.
    """
    def parse(s):
        return date.fromisoformat(s)

    q_rows, a_rows = {}, {}
    for f in facts:
        if "start" not in f or "end" not in f or "filed" not in f:
            continue
        dur = (parse(f["end"]) - parse(f["start"])).days
        if 70 <= dur <= 110:
            q_rows.setdefault(f["end"], []).append(f)
        elif 330 <= dur <= 380:
            a_rows.setdefault(f["end"], []).append(f)

    def build(rows_by_end):
        out = []
        for end in sorted(rows_by_end):
            rows = rows_by_end[end]
            val, filed = _pick_original(rows)
            val = val / split_factor_after(filed, splits)
            out.append({"end": end,
                        "start": min(r["start"] for r in rows),
                        "val": val, "avail": filed})
        return out

    quarters = build(q_rows)
    annuals = build(a_rows)
    have = {q["end"] for q in quarters}
    for a in annuals:
        if a["end"] in have:
            continue
        inside = [q for q in quarters if a["start"] < q["end"] < a["end"]]
        if len(inside) == 3:
            quarters.append({"end": a["end"], "start": a["start"],
                             "val": round(a["val"] - sum(q["val"] for q in inside), 4),
                             "avail": a["avail"]})
            have.add(a["end"])
    quarters.sort(key=lambda q: q["end"])
    return quarters, annuals


def ttm_eps_at(quarters, annuals, friday):
    """TTM diluted EPS knowable on `friday` (ISO date), or None.

    The last four quarters public by then, required to look like a
    real consecutive year (span <= 380 days, no gap over 200). With
    no usable quarter set at all, an annual-only filer's latest
    public annual stands in.
    """
    avail = [q for q in quarters if q["avail"] <= friday]
    if len(avail) >= 4:
        last4 = avail[-4:]
        ends = [date.fromisoformat(q["end"]) for q in last4]
        if (ends[-1] - ends[0]).days <= 380 and all(
                (ends[i + 1] - ends[i]).days <= 200 for i in range(3)):
            return sum(q["val"] for q in last4)
    if not avail:
        ann = [a for a in annuals if a["avail"] <= friday]
        if ann:
            return ann[-1]["val"]
    return None


def compute_pe(bars, facts, splits):
    """The pe array for one series: close / point-in-time TTM EPS,
    null wherever the TTM is unknown or not positive."""
    quarters, annuals = build_eps_periods(facts, splits)
    if not quarters and not annuals:
        return None
    out = []
    for b in bars:
        ttm = ttm_eps_at(quarters, annuals, b[0])
        out.append(round(b[4] / ttm, 2) if ttm is not None and ttm > 0
                   else None)
    return out


# ------------------------------------------------- Johnny's indicator
# Buy/sell signal dates for the Finance chart, computed nightly here
# (added 2026-11-22; formula settled by Johnny, 2026-11-22, after two
# research rounds against this file's own history; the buy side's
# price condition was revised later the same day — see BUY below).
# Pure Python: the workflow installs only `requests`.
#
# BUY (every condition, the same day):
#   stocks:          RSI(14) <= 30, VIX >= 30, drawdown <= -30%,
#                    PEG <= 1 — and where PEG is undefined, a
#                    deeper drawdown <= -40% stands in for the
#                    PEG check
#   SPX/IXIC/GOLD/BTC (no earnings exist, no P/E array): the same
#                    without PEG — never presented as PEG-checked.
# Drawdown is the close against the trailing 2-year high — close /
# max(close over the trailing 504 bars, today included) - 1. It
# replaced the buy side's close <= 200-week MA condition on
# 2026-11-22 (Johnny's D1 adoption, after the drawdown study): on
# 2015-2026 the D1 form fired 112 buy episodes at a +51.1% median
# 1y forward return, against the settled form's 100 episodes at
# +46.7%. Later the same day Johnny switched the buy side to the
# combined form — D1's rule plus the drawdown study's D3 stand-in
# above (the -40% line wherever PEG cannot compute): on
# 2015-2026 the combined form fired 212 buy episodes at a +47.2%
# median 1y forward return, capturing 13.3% of major lows
# against D1's 6.8%; he took the breadth after living with D1's
# sparsity (COST, LLY and TSLA hold no D1 buy in their entire
# history). The SELL side below is unchanged and still uses the
# 200-week average, which is still computed for it.
# SELL (every condition held for 5 consecutive trading days; the
# signal is live from the 5th day through the end of the run):
#   stocks:          RSI(14) > 70, VIX < 15, PEG >= 2,
#                    close >= 200-week MA x 1.50
#   benchmarks:      the same without PEG.
# PEG = P/E / growth, growth the mean of the three most recent
# year-over-year EPS growth rates (252 trading days apart, EPS =
# close / P/E), in percent, capped at 25 (Lynch's ranges unadjusted);
# PEG is undefined unless EPS > 0 at all four points and growth > 0.
# Where PEG is undefined no SELL fires that day; on the BUY side
# the -40% drawdown stands in for the PEG check instead (above).
# The 200-week average is the mean of the last 1,000 closes including
# today; RSI(14) is Wilder's; the VIX is aligned point-in-time (the
# last VIX close on or before the series' own date).

_SIGNAL_NO_PEG_KEYS = {"SPX", "IXIC", "GOLD", "BTC"}
_SIGNAL_PERSIST = 5


def _sig_ma200w(closes):
    out = [None] * len(closes)
    total = 0.0
    for i, v in enumerate(closes):
        total += v
        if i >= 1000:
            total -= closes[i - 1000]
        if i >= 999:
            out[i] = total / 1000.0
    return out


def _sig_drawdown(closes):
    """Drawdown from the trailing 2-year high, per bar: closes[i] /
    max(close over the trailing 504 bars, today included) - 1.
    Defined on every bar (early bars use the bars available)."""
    out = [None] * len(closes)
    window = deque()
    for i, v in enumerate(closes):
        while window and closes[window[-1]] <= v:
            window.pop()
        window.append(i)
        if window[0] <= i - 504:
            window.popleft()
        out[i] = v / closes[window[0]] - 1.0
    return out


def _sig_rsi(closes, period=14):
    n = len(closes)
    out = [None] * n
    if n <= period:
        return out
    gain = []
    loss = []
    for i in range(1, n):
        d = closes[i] - closes[i - 1]
        gain.append(d if d > 0 else 0.0)
        loss.append(-d if d < 0 else 0.0)
    ag = sum(gain[:period]) / period
    al = sum(loss[:period]) / period

    def r(ag, al):
        if al == 0:
            return 100.0
        return 100.0 - 100.0 / (1.0 + ag / al)

    out[period] = r(ag, al)
    for i in range(period, len(gain)):
        ag = (ag * (period - 1) + gain[i]) / period
        al = (al * (period - 1) + loss[i]) / period
        out[i + 1] = r(ag, al)
    return out


def _sig_peg(bars, pe):
    """PEG per bar (None where undefined). pe aligns 1:1 with bars."""
    n = len(bars)
    out = [None] * n
    if not pe or len(pe) != n:
        return out
    eps = [None] * n
    for i in range(n):
        p = pe[i]
        if p is not None and p > 0:
            eps[i] = bars[i][4] / p
    Y = 252
    for i in range(3 * Y, n):
        e0, e1, e2, e3 = eps[i], eps[i - Y], eps[i - 2 * Y], eps[i - 3 * Y]
        if any(e is None or e <= 0 for e in (e0, e1, e2, e3)):
            continue
        g = ((e0 / e1 - 1) + (e1 / e2 - 1) + (e2 / e3 - 1)) / 3.0 * 100.0
        if g <= 0:
            continue
        if g > 25.0:
            g = 25.0
        p = pe[i]
        if p is None or p <= 0:
            continue
        out[i] = p / g
    return out


def compute_indicator_signals(key, bars, pe, vix_dates, vix_closes):
    """(buy_dates, sell_dates) for one daily series."""
    dates = [b[0] for b in bars]
    closes = [float(b[4]) for b in bars]
    n = len(closes)
    ma = _sig_ma200w(closes)
    rsi = _sig_rsi(closes)
    dd = _sig_drawdown(closes)
    peg = None if key in _SIGNAL_NO_PEG_KEYS else _sig_peg(bars, pe)
    buy = []
    sell = []
    run = 0
    for i in range(n):
        if ma[i] is None or rsi[i] is None:
            run = 0
            continue
        j = bisect.bisect_right(vix_dates, dates[i]) - 1
        if j < 0:
            run = 0
            continue
        vix = vix_closes[j]
        if key in _SIGNAL_NO_PEG_KEYS:
            is_buy = rsi[i] <= 30 and vix >= 30 and dd[i] <= -0.30
            is_sell = rsi[i] > 70 and vix < 15 and closes[i] >= ma[i] * 1.50
        else:
            if peg[i] is not None:
                peg_ok = peg[i] <= 1
                is_sell = (rsi[i] > 70 and vix < 15
                           and closes[i] >= ma[i] * 1.50
                           and peg[i] >= 2)
            else:
                # PEG undefined: the deeper drawdown stands in for
                # the buy side's PEG check (the combined form); the
                # sell side still requires a defined PEG >= 2, so
                # no sell can fire or persist through this day.
                peg_ok = dd[i] <= -0.40
                is_sell = False
            is_buy = (rsi[i] <= 30 and vix >= 30 and dd[i] <= -0.30
                      and peg_ok)
        if is_buy:
            buy.append(dates[i])
        run = run + 1 if is_sell else 0
        if run >= _SIGNAL_PERSIST:
            sell.append(dates[i])
    return buy, sell


def attach_indicator_signals(d_series, d_previous):
    """Compute buy/sell dates for every daily series in place.

    The VIX series built in this same run is the input; if it is
    somehow absent, the previous file's signals stand untouched.
    A stock whose P/E is missing this run (an EDGAR failure with no
    carried-over pe) keeps its previous signals, filtered to dates
    its current bars still carry — the same spirit as the P/E
    carry-over above."""
    vix_entry = d_series.get("VIX") or {}
    vix_bars = vix_entry.get("bars") or []
    if not vix_bars:
        log("  indicator: no VIX series this run — previous signals stand")
        return
    vix_dates = [b[0] for b in vix_bars]
    vix_closes = [float(b[4]) for b in vix_bars]
    total_buy = 0
    total_sell = 0
    for key, entry in d_series.items():
        if key == "VIX":
            continue
        bars = entry.get("bars") or []
        if not bars:
            continue
        buy, sell = compute_indicator_signals(
            key, bars, entry.get("pe"), vix_dates, vix_closes)
        if key not in _SIGNAL_NO_PEG_KEYS and not entry.get("pe"):
            prev = d_previous.get(key) or {}
            if prev.get("buy") or prev.get("sell"):
                have = {b[0] for b in bars}
                buy = [d for d in (prev.get("buy") or []) if d in have]
                sell = [d for d in (prev.get("sell") or []) if d in have]
                log("  indicator: %s has no P/E this run — previous "
                    "signals carried" % key)
        entry["buy"] = buy
        entry["sell"] = sell
        total_buy += len(buy)
        total_sell += len(sell)
    log("Indicator signals: %d buy days, %d sell days across %d series."
        % (total_buy, total_sell, len(d_series) - 1))


# ------------------------------------------------------------- share snapshots
# og-finance.jpg + og-finance-<TICKER>.jpg: dated snapshots of The
# Chart's own Price view, drawn from the SAME weekly output dict this
# script has just written — the page's default view (Weekly, the
# five-year window, line style) with the page's own maths: SMA(50) and
# SMA(200) over the full series' closes, the window's min/max across
# closes and both averages padded 6%, four gridlines, fmtAxis labels,
# "Mon ’YY" date labels. Colours are the page's constants (price in
# the theme text colour, MA50 #2962FF, MA200 #FF9800). og-finance.jpg
# is the S&P 500 — the instrument the page itself opens on — and each
# of Johnny's 19 stocks gets its own file, which the /s/finance/
# doorways declare as their og:image. Rendering mirrors the Bitcoin
# snapshot's rules: a failure here never touches the data files (they
# are already written), and the previous images stand.

_FIN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_FIN_BENCH = {"SPX", "IXIC", "GOLD", "BTC", "VIX"}


def _fin_sma(values, length):
    """The page's sma(): the mean of the last `length` closes,
    defined from index length-1 on."""
    out = [None] * len(values)
    total = 0.0
    for i, v in enumerate(values):
        total += v
        if i >= length:
            total -= values[i - length]
        if i >= length - 1:
            out[i] = total / length
    return out


def _fin_fmt_num(v):
    """The page's fmtNum(): en-US, always two decimals."""
    return format(v, ",.2f")


def _fin_fmt_axis(v):
    """The page's fmtAxis(): a 'k' form at five figures."""
    if abs(v) >= 10000:
        s = "%.1f" % (v / 1000.0)
        if s.endswith(".0"):
            s = s[:-2]
        return s + "k"
    return _fin_fmt_num(v)


def _fin_fmt_date(iso):
    """'Nov 13, 2026' — the Bitcoin snapshot's date form."""
    y, m, d = iso.split("-")
    return "%s %d, %s" % (_FIN_MONTHS[int(m) - 1], int(d), y)


def render_finance_snapshot(key, entry, out_path):
    """Draw one instrument's share snapshot from its weekly series.
    Returns the printed facts, so a check can prove the image and the
    data file tell the same story."""
    from PIL import Image, ImageDraw, ImageFont

    bars = entry["bars"]
    name = entry["name"]
    closes = [b[4] for b in bars]
    ma50 = _fin_sma(closes, 50)
    ma200 = _fin_sma(closes, 200)
    n_all = len(bars)
    count = min(n_all, 260)             # the page's 5Y weekly window
    start, end = n_all - count, n_all - 1

    lo, hi = None, None
    for i in range(start, end + 1):
        for v in (closes[i], ma50[i], ma200[i]):
            if v is not None:
                lo = v if lo is None else min(lo, v)
                hi = v if hi is None else max(hi, v)
    pad = (hi - lo) * 0.06              # the page's 6% headroom
    lo, hi = lo - pad, hi + pad

    last_close = closes[end]
    last_date = bars[end][0]
    date_s = _fin_fmt_date(last_date)
    # The page's dropdown label is name + ticker — except where the
    # name IS the ticker (AMD), where the page's own form doubles it.
    title = name if name == key else "%s (%s)" % (name, key)

    S = 2  # supersample: draw at 2x, downscale for clean lines
    W, H = 1200 * S, 630 * S
    BG = (7, 9, 14)              # the site's dark --bg-color, #07090e
    TEXT = (240, 243, 246)       # --text-color: the price line
    MUTED = (148, 163, 184)      # #94a3b8, the chart's label grey
    MA50C = (41, 98, 255)        # #2962FF
    MA200C = (255, 152, 0)       # #FF9800

    def font(sz, bold=False):
        fname = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        try:
            return ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/" + fname, sz * S)
        except OSError:
            return ImageFont.truetype(fname, sz * S)

    img = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(img)

    def blend(draw_fn, alpha):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(layer), alpha)
        img.paste(Image.alpha_composite(
            img.convert("RGBA"), layer).convert("RGB"), (0, 0))
        return ImageDraw.Draw(img)

    MX = 40 * S
    # ---- header: the instrument, the page's name for itself, the
    # latest close and the week it belongs to ----
    f_title, f_brand = font(33, True), font(16)
    dr.text((MX, 26 * S), title, font=f_title, fill=TEXT)
    dr.text((MX, 74 * S), "Finance & Markets \u2014 johnny-oneal.com",
            font=f_brand, fill=MUTED)
    f_close, f_note = font(30, True), font(13)
    close_s = "$" + _fin_fmt_num(last_close)
    cw = dr.textlength(close_s, font=f_close)
    dr.text((W - MX - cw, 26 * S), close_s, font=f_close, fill=TEXT)
    note_s = "Week ending " + date_s
    nw = dr.textlength(note_s, font=f_note)
    dr.text((W - MX - nw, 68 * S), note_s, font=f_note, fill=MUTED)
    # ---- the line key (the page's chart-key wording) + dated tag ----
    f_key = font(14)
    kx = MX
    for swatch, lab in ((TEXT, "Price"), (MA50C, "50-week average"),
                        (MA200C, "200-week average")):
        dr.rectangle([kx, 112 * S, kx + 26 * S, 116 * S], fill=swatch)
        dr.text((kx + 34 * S, 106 * S), lab, font=f_key, fill=MUTED)
        kx += 34 * S + dr.textlength(lab, font=f_key) + 22 * S
    tag = "Snapshot \u00b7 " + date_s
    tw = dr.textlength(tag, font=f_key)
    dr.text((W - MX - tw, 106 * S), tag, font=f_key, fill=MUTED)

    # ---- the chart: the page's price pane, its own geometry ----
    x0, x1 = 46 * S, 1086 * S
    y0, y1 = 140 * S, 556 * S
    plotW, plotH = x1 - x0, y1 - y0
    n = end - start + 1

    def X(i):
        return x0 + (plotW / 2 if n <= 1
                     else (i - start) / (n - 1) * plotW)

    def Y(p):
        return y0 + (hi - p) / (hi - lo) * plotH

    def grid(d, a):
        for g in range(4):
            gy = Y(lo + (hi - lo) * g / 3)
            d.line([(x0, gy), (x1, gy)], fill=(148, 163, 184, a),
                   width=S)
    dr = blend(grid, 46)
    f_ax = font(13)
    for g in range(4):
        gv = lo + (hi - lo) * g / 3
        dr.text((1096 * S, Y(gv) - 7 * S), _fin_fmt_axis(gv),
                font=f_ax, fill=MUTED)
    # date labels: five evenly spaced bars, the page's own picks
    for k in range(5):
        xi = start + int((n - 1) * k / 4 + 0.5)
        yy, mm, _dd = bars[xi][0].split("-")
        lab = "%s \u2019%s" % (_FIN_MONTHS[int(mm) - 1], yy[2:])
        lw = dr.textlength(lab, font=f_ax)
        lx = min(max(X(xi) - lw / 2, 24 * S), W - 24 * S - lw)
        dr.text((lx, 566 * S), lab, font=f_ax, fill=MUTED)

    def line(vals, color, width):
        seg = []
        for i in range(start, end + 1):
            if vals[i] is None:
                if len(seg) > 1:
                    dr.line(seg, fill=color, width=width, joint="curve")
                seg = []
            else:
                seg.append((X(i), Y(vals[i])))
        if len(seg) > 1:
            dr.line(seg, fill=color, width=width, joint="curve")

    line(closes, TEXT, 4)        # the page's 1.8px close line
    line(ma50, MA50C, 2 * S)     # the page's 2px 50-week average
    line(ma200, MA200C, 3 * S)   # the page's 3px 200-week average
    # the latest point, dotted like the Bitcoin snapshot's today dot
    ex, ey = X(end), Y(last_close)
    R = 5 * S
    dr.ellipse([ex - R, ey - R, ex + R, ey + R], fill=TEXT,
               outline=(255, 255, 255), width=S)

    dr.rectangle([0, 0, W - 1, H - 1], outline=(35, 40, 51), width=S)
    img = img.resize((1200, 630), Image.LANCZOS)
    img.save(out_path, "JPEG", quality=90)
    return {
        "key": key, "name": name, "title": title,
        "close": last_close, "close_s": close_s, "date": date_s,
        "window_bars": n, "first_bar": bars[start][0],
        "last_bar": last_date,
        "ma50": any(v is not None for v in ma50[start:end + 1]),
        "ma200": any(v is not None for v in ma200[start:end + 1]),
    }


def render_finance_snapshots(chart_output, out_dir):
    """Render og-finance.jpg (the S&P 500, the page's own opening
    view) and one og-finance-<TICKER>.jpg per stock of Johnny's 19,
    from the weekly output dict. Each render is isolated: a failure
    leaves that image's previous copy standing and is logged, never
    raised — the data files are already written."""
    series = chart_output.get("series") or {}
    jobs = []
    if series.get("SPX", {}).get("bars"):
        jobs.append(("SPX", os.path.join(out_dir, "og-finance.jpg")))
    for key in sorted(series):
        entry = series[key]
        if key in _FIN_BENCH or entry.get("ndx"):
            continue
        if entry.get("bars"):
            jobs.append((key, os.path.join(
                out_dir, "og-finance-%s.jpg" % key)))
    done = []
    for key, out_path in jobs:
        try:
            st = render_finance_snapshot(key, series[key], out_path)
            done.append(st)
            log("  snapshot %s: %s, close %s, week ending %s"
                % (os.path.basename(out_path), st["title"],
                   st["close_s"], st["date"]))
        except Exception as exc:
            log("  WARNING: snapshot for %s failed (%s) — previous "
                "image stands." % (key, exc))
    log("Share snapshots: %d of %d rendered." % (len(done), len(jobs)))
    return done


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else OUT_FILE
    now_utc = datetime.now(timezone.utc)
    today = now_utc.date()
    through = last_completed_friday(today, now_utc)
    period1 = int(datetime(START.year, START.month, START.day,
                           tzinfo=timezone.utc).timestamp())
    period2 = int(now_utc.timestamp()) + 86400

    previous = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as fh:
                previous = (json.load(fh) or {}).get("series") or {}
        except Exception as exc:
            log("WARNING: could not read previous %s (%s); treating as empty"
                % (out_path, exc))
            previous = {}

    # P/E preparation: one CIK map for the whole run, companyfacts
    # cached per CIK (GOOG and GOOGL share one). Any EDGAR failure is
    # logged and simply leaves series without fresh pe — prices are
    # never held hostage to it.
    cik_map = {}
    try:
        cik_map = load_cik_map()
        log("EDGAR ticker map loaded (%d tickers)." % len(cik_map))
    except Exception as exc:
        log("EDGAR ticker map FAILED (%s) — no fresh P/E this run." % exc)
    facts_cache = {}
    splits_cache = {}

    def pe_for(key, symbol, bars):
        if key in BENCHMARK_KEYS or symbol in PE_EXCLUDE:
            return None
        cik = cik_map.get(symbol)
        if not cik:
            return None
        if cik not in facts_cache:
            facts = fetch_edgar_json(EDGAR_FACTS_URL % cik)
            units = (facts.get("facts", {}).get("us-gaap", {})
                     .get("EarningsPerShareDiluted", {}).get("units", {}))
            facts_cache[cik] = units.get("USD/shares")
            time.sleep(0.15)  # SEC fair access: stay well under 10/s
        eps_facts = facts_cache[cik]
        if not eps_facts:
            return None
        # Split history, one keyless Yahoo call per symbol. Without
        # it the EPS history cannot be put on the prices' basis, so
        # a failure ships no fresh P/E (the previous file's carries
        # over) rather than an unadjusted one.
        if symbol not in splits_cache:
            splits_cache[symbol] = fetch_splits(symbol)
            time.sleep(0.15)
        pe = compute_pe(bars, eps_facts, splits_cache[symbol])
        if pe is None or not any(v is not None for v in pe):
            return None
        return pe

    series = {}
    missing = []
    kept_old = []
    for key, symbol, name in ALL_INSTRUMENTS:
        log("=== %s (%s) ===" % (key, symbol))
        try:
            bars = fetch_yahoo(symbol, period1, period2)
            bars = [b for b in bars if b[0] <= through.isoformat()]
            if not bars:
                raise ValueError("no completed weekly bars returned")
        except Exception as exc:
            log("  FAILED: %s" % exc)
            if key in previous and previous[key].get("bars"):
                series[key] = previous[key]
                kept_old.append(key)
                log("  keeping previous series (%d bars, through %s)"
                    % (len(previous[key]["bars"]), previous[key]["bars"][-1][0]))
            else:
                missing.append(key)
            time.sleep(1)
            continue
        log("  %d weekly bars, %s .. %s, last close %.2f"
            % (len(bars), bars[0][0], bars[-1][0], bars[-1][4]))
        entry = {"name": name, "symbol": symbol, "bars": bars}
        if key in NDX_ONLY_KEYS:
            # Chart-only flag: the page's first dropdown, scoreboard,
            # runner and backtest never see these; the second
            # (Nasdaq-100) dropdown works from "nasdaq100" below.
            entry["ndx"] = True
        # P/E: fresh from EDGAR where computable; on any failure, the
        # previous pe carries over only when the old bars are a strict
        # date-prefix of the new ones (appended weeks get null — their
        # P/E is unknown this run, never a stale repeat).
        try:
            pe = pe_for(key, symbol, bars)
        except Exception as exc:
            log("  P/E FAILED for %s: %s" % (key, exc))
            pe = None
        if pe is None and key in previous:
            prev = previous[key]
            prev_bars = prev.get("bars") or []
            prev_pe = prev.get("pe")
            if prev_pe and len(prev_pe) == len(prev_bars) and \
                    [b[0] for b in prev_bars] == \
                    [b[0] for b in bars[:len(prev_bars)]]:
                pe = list(prev_pe) + [None] * (len(bars) - len(prev_pe))
                log("  P/E carried over from the previous file for %s" % key)
        if pe is not None:
            entry["pe"] = pe
            log("  P/E: %d of %d weeks computable"
                % (sum(1 for v in pe if v is not None), len(pe)))
        elif key not in BENCHMARK_KEYS and symbol not in PE_EXCLUDE:
            log("  P/E: none computable for %s" % key)
        series[key] = entry
        time.sleep(1)  # be polite to the endpoint

    if missing:
        # An instrument with neither fresh nor previous data must never
        # silently vanish from the chart: fail the run, keep the old file.
        log("NO DATA for %s — leaving the previous %s untouched."
            % (", ".join(missing), out_path))
        return 1

    last_dates = [s["bars"][-1][0] for s in series.values() if s.get("bars")]
    output = {
        "last_updated": today.isoformat(),
        "source": "Yahoo Finance v8 chart API (query1.finance.yahoo.com), "
                  "weekly OHLCV bars dated by each week's Friday; "
                  "completed weeks only. P/E arrays: weekly close / "
                  "trailing-twelve-month diluted EPS from SEC EDGAR "
                  "companyfacts, point-in-time by first filing date, "
                  "each period taken from its original filing and "
                  "split-adjusted to the prices' basis",
        "through": max(last_dates) if last_dates else None,
        "series": series,
        "nasdaq100": [ticker for ticker, _name in NASDAQ100],
    }
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w") as fh:
        json.dump(output, fh, separators=(",", ":"))
    os.replace(tmp_path, out_path)
    log("Wrote %s (%d instruments, through %s%s)."
        % (out_path, len(series), output["through"],
           ", kept previous for: " + ", ".join(kept_old) if kept_old else ""))

    # ---- share snapshots: og-finance.jpg + one
    # og-finance-<TICKER>.jpg per stock, drawn from the weekly
    # output just written (the share-snapshots section above).
    # Isolated like the daily file below: a render failure
    # leaves the previous images standing and never touches
    # the data files.
    try:
        render_finance_snapshots(
            output, os.path.dirname(os.path.abspath(out_path)))
    except Exception as exc:
        log("WARNING: share snapshots failed (%s) — previous "
            "og-finance images stand." % exc)

    # ---- the daily file: same instruments, daily bars, full history ----
    # Written second, from the same EDGAR facts cache, so a daily
    # failure can never degrade the weekly file above. The workflow's
    # commit step picks this file up once its name joins the git add
    # line; until then the committed copy is the one this script's
    # runs ship by hand.
    daily_path = os.path.join(os.path.dirname(os.path.abspath(out_path)),
                              DAILY_OUT_FILE)
    through_day = last_completed_day(today, now_utc)
    # Full history: the same START as the weekly fetch (2000-01-01).
    # Until 2026-11-20 this was years_ago(today, 5), which capped the
    # chart's Daily view at the 5Y range.
    cutoff = START
    d_period1 = period1 - 10 * 86400
    d_previous = {}
    if os.path.exists(daily_path):
        try:
            with open(daily_path) as fh:
                d_previous = (json.load(fh) or {}).get("series") or {}
        except Exception as exc:
            log("WARNING: could not read previous %s (%s); treating as empty"
                % (daily_path, exc))
            d_previous = {}
    d_series = {}
    d_missing = []
    d_kept_old = []
    for key, symbol, name in ALL_INSTRUMENTS:
        log("=== %s (%s) daily ===" % (key, symbol))
        try:
            bars = fetch_yahoo_daily(symbol, d_period1, period2)
            bars = [b for b in bars
                    if cutoff.isoformat() <= b[0] <= through_day.isoformat()]
            if not bars:
                raise ValueError("no completed daily bars returned")
        except Exception as exc:
            log("  FAILED: %s" % exc)
            if key in d_previous and d_previous[key].get("bars"):
                d_series[key] = d_previous[key]
                d_kept_old.append(key)
                log("  keeping previous daily series (%d bars, through %s)"
                    % (len(d_previous[key]["bars"]),
                       d_previous[key]["bars"][-1][0]))
            else:
                d_missing.append(key)
            time.sleep(1)
            continue
        log("  %d daily bars, %s .. %s, last close %.2f"
            % (len(bars), bars[0][0], bars[-1][0], bars[-1][4]))
        entry = {"name": name, "symbol": symbol, "bars": bars}
        if key in NDX_ONLY_KEYS:
            entry["ndx"] = True
        try:
            pe = pe_for(key, symbol, bars)
        except Exception as exc:
            log("  P/E FAILED for %s: %s" % (key, exc))
            pe = None
        if pe is None and key in d_previous:
            prev = d_previous[key]
            prev_bars = prev.get("bars") or []
            prev_pe = prev.get("pe")
            if prev_pe and len(prev_pe) == len(prev_bars) and \
                    [b[0] for b in prev_bars] == \
                    [b[0] for b in bars[:len(prev_bars)]]:
                pe = list(prev_pe) + [None] * (len(bars) - len(prev_pe))
                log("  P/E carried over from the previous daily file for %s" % key)
        if pe is not None:
            entry["pe"] = pe
            log("  P/E: %d of %d days computable"
                % (sum(1 for v in pe if v is not None), len(pe)))
        elif key not in BENCHMARK_KEYS and symbol not in PE_EXCLUDE:
            log("  P/E: none computable for %s" % key)
        d_series[key] = entry
        time.sleep(1)  # be polite to the endpoint

    if d_missing:
        log("NO DAILY DATA for %s — leaving the previous %s untouched "
            "(the weekly %s above is unaffected)."
            % (", ".join(d_missing), daily_path, out_path))
        return 1

    # Johnny's indicator: buy/sell signal dates on every daily
    # series, from this run's own bars, P/E and VIX (see the
    # indicator section above compute_pe).
    try:
        attach_indicator_signals(d_series, d_previous)
    except Exception as exc:
        log("WARNING: indicator signals failed (%s) — the daily file "
            "ships without fresh signals." % exc)

    d_last_dates = [s["bars"][-1][0] for s in d_series.values() if s.get("bars")]
    d_output = {
        "last_updated": today.isoformat(),
        "source": "Yahoo Finance v8 chart API (query1.finance.yahoo.com), "
                  "daily OHLCV bars since 2000 (or the instrument's "
                  "first trading day); "
                  "completed days only. P/E arrays: daily close / "
                  "trailing-twelve-month diluted EPS from SEC EDGAR "
                  "companyfacts, point-in-time by first filing date, "
                  "each period taken from its original filing and "
                  "split-adjusted to the prices' basis. Buy/sell "
                  "arrays: Johnny's indicator signal dates, computed "
                  "from these bars, P/E arrays and the VIX series",
        "through": max(d_last_dates) if d_last_dates else None,
        "series": d_series,
        "nasdaq100": [ticker for ticker, _name in NASDAQ100],
    }
    d_tmp_path = daily_path + ".tmp"
    with open(d_tmp_path, "w") as fh:
        json.dump(d_output, fh, separators=(",", ":"))
    os.replace(d_tmp_path, daily_path)
    log("Wrote %s (%d instruments, through %s%s)."
        % (daily_path, len(d_series), d_output["through"],
           ", kept previous for: " + ", ".join(d_kept_old) if d_kept_old else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
