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

Score dots (added 2026-11-23): each daily series also gains a
"score_buys" array — the days the 100-point Buy Opportunity Score
reaches its strong tier (85 or higher) that are NOT already buy
days under the gate above: the union Johnny adopted on 2026-11-23,
the gate's dots and the score's dots side by side, sells untouched
(see compute_score_buy_days below for the exact point table). The
score is the graded-score study's V1 (2026-11-22), reproduced
exactly; the page draws these days as ringed dots beside the gate's
filled ones.

Earnings door and veto (added 2026-11-23): for Johnny's 19 stocks
only, the run also builds point-in-time earnings events from SEC
EDGAR companyfacts (see build_earnings_events below — the earnings
study's exact construction: every figure as first reported, an
event tradable only from the first trading day after its filing)
and applies the two rules Johnny adopted from that study: a
good-print buy door (B1) unioned with the gate, and a clean-print
sell veto (S4) that suppresses a sell episode whose latest print
is clean. The other series have no events in the study and are
untouched; the known blind spots stay blind — NBIS and TSM file
no usable quarterly facts, and JPM reports no gross margin, so
the veto can never fire on it.

Rotation veto (added 2026-11-23): for the same 19 stocks, the
run also builds each name's sector relative-strength regime
from Yahoo adjusted closes (sector ETF / SPX, the sell study's
exact construction — see the Rotation veto note above
compute_indicator_signals) and applies the R2 veto Johnny
adopted from sell study #2: a sell episode whose first day
falls in a sector rotating UP is suppressed whole. In the
study, 19 of the gate's 29 validation sell episodes on the 19
fired into strengthening sectors and those names rose a median
+82.3% over the following year; the veto removes that failure
mode and creates no sell signal of its own.

Market context (added 2026-11-23): the same run also writes
finance-context.json, built by market_context.py (imported
lazily at the end of main, so a context failure can never touch
the chart files): insider-buying clusters from SEC EDGAR
Form 4 filings, the share of this run's own universe trading
above its 200-day average, and the ICE BofA high-yield spread
from FRED. It is DATA ONLY — no signal reads it yet. It exists
so the next formula question can be studied against real
history instead of asserted.
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
    ("SATS", "SATS", "Strive SATS Preferred Stock"),
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
    ("STRC", "STRC", "Strategy Stretch Preferred Stock"),
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

# The Market/Futures band's own instruments (pass 2, 2026-11-22):
# the strip at the top of the Finance page became the chart's
# selector, so every cell needs a real series behind it. Keys match
# the band's instrument ids on the page (the page maps its cell ids
# to these keys). None of them has earnings, so none gets a P/E —
# the indicator treats them with the 40%-drawdown stand-in leg,
# exactly like SPX/IXIC/GOLD/BTC. They join the chart and the
# Latest-dots universe only: never the Scoreboard or Drill Down,
# which stay Johnny's 19 stocks (the page keeps them out of its
# stock dropdown via the "band" flag written on each entry).
BAND_INSTRUMENTS = [
    ("DOW", "^DJI", "Dow Jones Industrial Average"),
    ("RUT", "^RUT", "Russell 2000"),
    ("TNX", "^TNX", "10-Year Treasury Yield"),
    ("DOLLAR", "DX-Y.NYB", "US Dollar Index"),
    ("EURO", "EURUSD=X", "Euro (EUR/USD)"),
    ("SILVER", "SI=F", "Silver"),
    ("COPPER", "HG=F", "Copper"),
    ("OIL", "CL=F", "Oil (WTI crude)"),
    ("BRENT", "BZ=F", "Brent Crude"),
    ("NATGAS", "NG=F", "Natural Gas"),
    ("CORN", "ZC=F", "Corn"),
    ("WHEAT", "ZW=F", "Wheat"),
]
BAND_KEYS = {key for key, _symbol, _name in BAND_INSTRUMENTS}
ALL_INSTRUMENTS = INSTRUMENTS + NDX_INSTRUMENTS + BAND_INSTRUMENTS

OUT_FILE = "finance-chart-data.json"
DAILY_OUT_FILE = "finance-chart-daily.json"
FIRST_OUT_FILE = "finance-chart-first.json"
# The first-paint file carries SPX daily bars from this date: enough
# for the chart's opening Daily · 5Y view (1,260 bars) plus the
# lookback the 200-day line needs at the window's first bar.
FIRST_FILE_CUTOFF = "2017-01-01"
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
# Johnny's two preferreds (added 2026-11-23): Strategy's STRC
# (Variable Rate Series A Perpetual Stretch Preferred, listed
# 2025-07-30) and Strive's SATS (15.00% Series A Perpetual SATS
# Preferred, listed 2026-10-20). A preferred carries no earnings
# of its own — in EDGAR's ticker map each preferred resolves to
# its issuer's common-stock CIK (STRC to Strategy's, SATS to
# Strive's) — so no P/E is ever built for them and their signals
# run in the no-PEG class, exactly like the benchmarks and the
# band: the main door and the sell rule drop the PEG leg, the
# -40% stand-in door does not apply (that door exists for
# ordinary stocks whose PEG fails to compute; here PEG never
# applies), and the quality door, the B1 door and the S4 veto,
# which all read earnings or PEG, can never fire. Their histories
# (hundreds of bars for STRC, weeks for SATS) are far short of
# the 1,000 closes the 200-week average needs, so that leg stays
# undefined and the gate cannot fire yet — the same honest state
# ASST sits in today.
PREFERRED_KEYS = {"STRC", "SATS"}
BENCHMARK_KEYS = {"SPX", "IXIC", "GOLD", "BTC", "VIX"} | BAND_KEYS \
    | PREFERRED_KEYS  # no EPS exists
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


def fetch_yahoo_adjclose(symbol, period1, period2):
    """Daily ADJUSTED closes: (dates, values), oldest first.

    The rotation veto's one input the plain daily fetch does
    not carry: sell study #2 built its sector RS lines from
    Yahoo's dividend/split-adjusted closes, so the production
    regime reads the same series (indicators.adjclose), never
    the raw close. Bars with no adjusted close are skipped —
    the study's own construction. A response with no adjclose
    block at all is a failure, not an empty series."""
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
        adj = (result[0].get("indicators", {}).get("adjclose")
               or [{}])[0].get("adjclose")
        if adj is None:
            raise ValueError("no adjclose block for %s" % symbol)
        stamps = result[0].get("timestamp") or []
        by_date = {}
        for i, ts in enumerate(stamps):
            v = adj[i] if i < len(adj) else None
            if v is None or float(v) <= 0:
                continue  # no adjusted close, no bar
            d = datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()
            by_date[d] = float(v)
        dates = sorted(by_date)
        return dates, [by_date[d] for d in dates]
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


# ------------------------------------------------- earnings events
# Point-in-time quarterly earnings events for Johnny's 19 stocks,
# the data under the adopted B1 door / S4 veto (see the formula
# notes above compute_indicator_signals). The construction is the
# earnings study's, reproduced exactly (study #6, 2026-11-23):
# - every figure AS FIRST REPORTED: per fiscal period the
#   earliest filing wins; restated values in later filings are
#   never used;
# - a quarter is a flow duration of 75-110 days, an annual
#   330-380; periods are keyed by END date (different concepts
#   tag the same quarter with start dates a day apart);
# - Q4 is derived as the fiscal year minus the three quarters
#   inside that year's own window, public at the annual's
#   filing date;
# - gross profit is derived as revenue minus cost where the
#   GrossProfit tag is absent (marked nowhere — the study's
#   events carry it identically);
# - EPS is filled as net income / share count only where the
#   EPS tag itself is absent;
# - an event's public date is the LATEST filed date among its
#   components (the quarter is only fully public when every
#   used figure is public), and it becomes tradable on the
#   first trading day strictly after that date.
# TSM files under ifrs-full (its us-gaap concepts are absent);
# every feature built on its facts is a ratio, so the TWD unit
# washes out — and in practice its facts carry no quarterly
# durations at all, so it builds no events, exactly as the
# study found. NBIS likewise files annual periods only.

EARNINGS_KEYS = ["GOOGL", "ASST", "CIFR", "SPCX", "NBIS", "IREN",
                 "AAOI", "NVDA", "AMD", "PLTR", "MU", "TSLA", "MSTR",
                 "TSM", "LLY", "WM", "COST", "JPM", "WMT"]
_EARN_REV_CHAIN = ["RevenueFromContractWithCustomerExcludingAssessedTax",
                   "SalesRevenueNet", "Revenues",
                   "RevenuesNetOfInterestExpense"]
_EARN_SHARES_CHAIN = ["WeightedAverageNumberOfDilutedSharesOutstanding",
                      "WeightedAverageNumberOfSharesOutstandingBasic"]
_EARN_COST_CHAIN = ["CostOfRevenue", "CostOfGoodsAndServicesSold",
                    "CostOfGoodsSold"]


def _earn_entries(facts, taxonomy, tag):
    """All flow facts for one concept, flattened across units:
    [{start, end, val, filed, dur}] with dur in days, inclusive."""
    units = (facts.get("facts", {}).get(taxonomy, {}).get(tag, {})
             .get("units", {}))
    out = []
    for entries in units.values():
        for e in entries:
            if "start" not in e or "end" not in e:
                continue
            dur = (date.fromisoformat(e["end"])
                   - date.fromisoformat(e["start"])).days + 1
            out.append({"start": e["start"], "end": e["end"],
                        "val": e["val"], "filed": e["filed"],
                        "dur": dur})
    return out


def _earn_instant(facts, taxonomy, tag):
    """Instant (balance-sheet-date) facts: {end: earliest-filed
    entry}."""
    units = (facts.get("facts", {}).get(taxonomy, {}).get(tag, {})
             .get("units", {}))
    out = {}
    for entries in units.values():
        for e in entries:
            if "end" not in e:
                continue
            k = e["end"]
            if k not in out or e["filed"] < out[k]["filed"]:
                out[k] = {"val": e["val"], "filed": e["filed"]}
    return out


def _earn_first_reported(entries, lo, hi):
    """{(start, end): entry} within a duration band, keeping the
    earliest-filed entry per period."""
    best = {}
    for e in entries:
        if not (lo <= e["dur"] <= hi):
            continue
        k = (e["start"], e["end"])
        if k not in best or e["filed"] < best[k]["filed"]:
            best[k] = e
    return best


def _earn_concept(facts, taxonomy, tags):
    """Merged quarterly/annual first-reported maps for a concept
    given a fallback tag chain: per period, the first tag that
    reports it wins."""
    q, a = {}, {}
    for tag in tags:
        entries = _earn_entries(facts, taxonomy, tag)
        for k, e in _earn_first_reported(entries, 75, 110).items():
            q.setdefault(k, e)
        for k, e in _earn_first_reported(entries, 330, 380).items():
            a.setdefault(k, e)
    return q, a


def build_earnings_events(key, facts):
    """The event list for one of the 19: [{end, filed, eps, ni,
    rev, gp, oi, derived_q4, eps_derived}] sorted by period end.
    `facts` is the company's full EDGAR companyfacts document."""
    if key == "TSM":
        # Foreign private issuer: us-gaap concepts are absent;
        # the facts live under ifrs-full.
        tax = "ifrs-full"
        eps_q, eps_a = _earn_concept(facts, tax, [
            "DilutedEarningsLossPerShare", "BasicEarningsLossPerShare"])
        ni_q, ni_a = _earn_concept(facts, tax, ["ProfitLoss"])
        rev_q, rev_a = _earn_concept(facts, tax, ["Revenue"])
        gp_q, gp_a = _earn_concept(facts, tax, ["GrossProfit"])
        oi_q, oi_a = _earn_concept(facts, tax, [
            "ProfitLossFromOperatingActivities"])
        cost_q, cost_a = {}, {}
        sh_q, sh_inst = {}, {}
    else:
        tax = "us-gaap"
        eps_q, eps_a = _earn_concept(facts, tax, [
            "EarningsPerShareDiluted", "EarningsPerShareBasic"])
        ni_q, ni_a = _earn_concept(facts, tax, ["NetIncomeLoss"])
        rev_q, rev_a = _earn_concept(facts, tax, _EARN_REV_CHAIN)
        gp_q, gp_a = _earn_concept(facts, tax, ["GrossProfit"])
        oi_q, oi_a = _earn_concept(facts, tax, ["OperatingIncomeLoss"])
        cost_q, cost_a = _earn_concept(facts, tax, _EARN_COST_CHAIN)
        sh_q, _sh_a = _earn_concept(facts, tax, _EARN_SHARES_CHAIN)
        sh_inst = _earn_instant(facts, tax,
                                "CommonStockSharesOutstanding")

    # Periods are keyed by END date from here on (see the section
    # notes). Within a concept, duplicate ends keep the earliest
    # filing.
    def by_end(m):
        out = {}
        for (_s, e), ent in m.items():
            if e not in out or ent["filed"] < out[e]["filed"]:
                out[e] = ent
        return out

    eps_q, eps_a = by_end(eps_q), by_end(eps_a)
    ni_q, ni_a = by_end(ni_q), by_end(ni_a)
    rev_q, rev_a = by_end(rev_q), by_end(rev_a)
    gp_q, gp_a = by_end(gp_q), by_end(gp_a)
    oi_q, oi_a = by_end(oi_q), by_end(oi_a)
    cost_q, cost_a = by_end(cost_q), by_end(cost_a)
    sh_q = by_end(sh_q)
    concepts = {"eps": (eps_q, eps_a), "ni": (ni_q, ni_a),
                "rev": (rev_q, rev_a), "gp": (gp_q, gp_a),
                "oi": (oi_q, oi_a)}

    # Gross profit derived as revenue - cost where the GrossProfit
    # tag is absent for a period (GOOGL, LLY, WM, WMT, COST report
    # cost lines instead). Never overrides a reported gross profit.
    for e, cent in cost_q.items():
        if e in rev_q and e not in gp_q:
            gp_q[e] = {"val": rev_q[e]["val"] - cent["val"],
                       "filed": max(rev_q[e]["filed"], cent["filed"])}
    for e, cent in cost_a.items():
        if e in rev_a and e not in gp_a:
            gp_a[e] = {"start": rev_a[e]["start"],
                       "val": rev_a[e]["val"] - cent["val"],
                       "filed": max(rev_a[e]["filed"], cent["filed"])}

    quarters = {}
    for name, (qm, _am) in concepts.items():
        for e, ent in qm.items():
            rec = quarters.setdefault(e, {})
            rec[name] = ent["val"]
            rec.setdefault("_filed", []).append(ent["filed"])

    # Q4 derivation: FY value minus the three quarters of that
    # fiscal year, matched by the annual period's own window
    # (start, end] — NOT by the fy field: a first-reported entry
    # can be a comparative carried in a later filing whose fy
    # label names the later year, which poisons fy matching.
    for name, (qm, am) in concepts.items():
        for e, fy_ent in am.items():
            s_a = fy_ent["start"]
            qs = [ent for qe, ent in qm.items() if s_a < qe < e]
            if len(qs) != 3:
                continue
            if e in quarters and name in quarters[e]:
                continue  # a direct quarter already ends at FY end
            rec = quarters.setdefault(e, {})
            if name not in rec:
                rec[name] = fy_ent["val"] - sum(q["val"] for q in qs)
                rec.setdefault("_filed", []).append(fy_ent["filed"])
                rec["_derived"] = True

    events = []
    for e, rec in quarters.items():
        ev = {"end": e, "filed": max(rec["_filed"]),
              "eps": rec.get("eps"), "ni": rec.get("ni"),
              "rev": rec.get("rev"), "gp": rec.get("gp"),
              "oi": rec.get("oi"),
              "derived_q4": bool(rec.get("_derived")),
              "eps_derived": False}
        # EPS filled definitionally as net income / weighted
        # diluted shares where the EPS tag itself is absent for
        # the period (the tag is thin for TSLA before 2015). Both
        # inputs are as-first-reported; the fill is marked.
        if ev["eps"] is None and ev["ni"] is not None:
            den = sh_q.get(e) or sh_inst.get(e)
            if den and den["val"]:
                ev["eps"] = ev["ni"] / den["val"]
                ev["eps_derived"] = True
                ev["filed"] = max(ev["filed"], den["filed"])
        events.append(ev)
    events.sort(key=lambda x: x["end"])
    return events


def earnings_daily_state(events, bar_dates):
    """The latest-print state on each bar, as the study computed
    it: {age, eps_yoy, rev_yoy, gm_chg_yoy} lists aligned 1:1
    with bar_dates (None on a bar with no live print or no
    computable leg), or None if no event is ever tradable.

    Year-over-year legs are positional (four events back) with
    chain breaks wherever consecutive period ends gap by more
    than 150 days — lags across a break are missing, never
    interpolated. EPS YoY divides by the year-ago EPS only when
    it is positive (the study's rule; a negative base makes the
    ratio meaningless). Age is trading days since the print
    became tradable."""
    n = len(bar_dates)
    ords = [date.fromisoformat(d).toordinal() for d in bar_dates]
    ends = [date.fromisoformat(e["end"]).toordinal() for e in events]

    def lag(i, k, field):
        if i - k < 0:
            return None
        for m in range(i - k + 1, i + 1):
            if ends[m] - ends[m - 1] > 150:
                return None
        return events[i - k][field]

    live = []
    for i, e in enumerate(events):
        eps, eps4 = e["eps"], lag(i, 4, "eps")
        rev, rev4 = e["rev"], lag(i, 4, "rev")
        eps_yoy = ((eps - eps4) / abs(eps4)
                   if (eps is not None and eps4 is not None
                       and eps4 > 0) else None)
        rev_yoy = (rev / rev4 - 1.0
                   if (rev is not None and rev4 is not None
                       and rev4 > 0) else None)
        gm = (e["gp"] / rev) if (e["gp"] is not None and rev) else None
        gp4, rev4b = lag(i, 4, "gp"), lag(i, 4, "rev")
        gm4 = (gp4 / rev4b) if (gp4 is not None and rev4b) else None
        gm_chg = (gm - gm4) if (gm is not None
                                and gm4 is not None) else None
        j = bisect.bisect_right(
            ords, date.fromisoformat(e["filed"]).toordinal())
        if j < n:
            live.append({"j": j, "eps_yoy": eps_yoy,
                         "rev_yoy": rev_yoy, "gm_chg_yoy": gm_chg})
    if not live:
        return None
    age = [None] * n
    ey = [None] * n
    ry = [None] * n
    gm = [None] * n
    li = 0
    for t in range(n):
        while li < len(live) and live[li]["j"] <= t:
            li += 1
        if li > 0:
            f = live[li - 1]
            age[t] = t - f["j"]
            ey[t] = f["eps_yoy"]
            ry[t] = f["rev_yoy"]
            gm[t] = f["gm_chg_yoy"]
    return {"age": age, "eps_yoy": ey, "rev_yoy": ry,
            "gm_chg_yoy": gm}


# ------------------------------------------------- Johnny's indicator
# Buy/sell signal dates for the Finance chart, computed nightly here
# (added 2026-11-22; formula settled by Johnny, 2026-11-22, after two
# research rounds against this file's own history; the buy side's
# price condition was revised later the same day — see BUY below).
# Pure Python: the workflow installs only `requests`.
#
# BUY (every condition, the same day):
#   stocks:          RSI(14) <= 30, VIX >= 25, drawdown <= -30%,
#                    PEG <= 1 — and where PEG is undefined, a
#                    deeper drawdown <= -40% stands in for the
#                    PEG check
#   SPX/IXIC/GOLD/BTC (no earnings exist, no P/E array): the same
#                    without PEG — never presented as PEG-checked.
#                    Index split (2026-11-23; Johnny's adoption of
#                    the indicator-classes study, section 5): SPX
#                    and IXIC buy at drawdown <= -25% — at -30% the
#                    indexes sat near-silent (SPX's ten career buys
#                    all landed Oct 2008-Mar 2009), while at -25%
#                    both clear the reliability bar individually
#                    (validation capture 33% -> 100%, median 1y
#                    +23.5%; the wider line adds 2020-03-12 on both
#                    indexes, 2022-09-30 on SPX and 2008-09-17 on
#                    IXIC). GOLD, BTC and the band instruments keep
#                    the -30% line exactly.
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
# Quality door (added 2026-11-23; Johnny's adoption of candidate
# C1 from the indicator research study of the same day): a second,
# shallower buy door for stocks too strong to ever fall 30% —
# RSI(14) <= 30, VIX >= 25, drawdown <= -20%, close BELOW the
# 200-week average, PEG defined and <= 2 (Lynch's warning line as
# the cap). It unions with the buy above: either door marks the
# day. PEG-class names only — where PEG cannot be calculated the
# door never opens (it has no stand-in leg), and the benchmarks
# and band instruments, which carry no P/E array, are never
# quality-door days. In the study (2015-2026, this file's own
# history) the door added 90 buy episodes universe-wide; the
# added episodes on Johnny's 19 earned a +30.6% median 1y
# forward return against the main door's +31.2%, and it is the
# only tested door that has ever put buy dots on WMT (5
# episodes, on its May-June 2022 low).
# Score dots (added 2026-11-23; Johnny's adoption of the union
# the graded-score study pointed to): beside the gate, each day
# also carries the 100-point Buy Opportunity Score — drawdown
# depth 30 (steps at 15/20/25/30/35/40%), daily RSI(14) 20,
# valuation 25 (PEG tiers 0.75/1.00/1.25/1.50/2.00), distance
# below the 200-week average 15, VIX 10 as a bonus that can
# never block. Where PEG cannot compute, the valuation leg
# falls back to the gate's own stand-in: the PEG <= 1 tier's
# 22 points only when the drawdown is at least -40%, else 0 —
# one rule for every series, benchmarks and band instruments
# included. Days scoring 85 or higher that are not already gate
# buy days are emitted as "score_buys", a dot class of their
# own. In the graded-score study (2015-2026, this file's own
# history) the >= 85 days beat the gate alone on Johnny's 19 at
# every horizon (median 1y +43.0% vs +31.2%, 2y +166.4% vs
# +112.1%, capture 15.9% vs 13.0%, false share 58% vs 67%),
# and the follow-up check priced the union — every gate dot
# kept, the >= 85-only days added — above either set alone
# (117 episodes on the 19, median 1y +37.5%, capture 20.3%,
# false 61%). The sell side has no score: the study's sell
# score ordered nothing and is not used.
# Earnings door and veto (added 2026-11-23; Johnny's adoption
# of study #6's two clearing candidates, same day): for the 19
# earnings-universe stocks only, two rules ride on the gate,
# both read off the point-in-time earnings events built below
# (an event is the latest print once its filing is public; its
# age is the trading days since it became tradable):
#   B1 good-print buy door — a day is ALSO a buy day when
#     RSI(14) <= 30, VIX >= 25, drawdown <= -20%, and the
#     latest print is at most 90 trading days old with EPS and
#     revenue both up year over year. The door unions with the
#     gate above; it has no PEG leg and no 200-week-average
#     condition, exactly as studied. In the study the door
#     raised validation buy capture on the pure operators
#     0.304 -> 0.391 and on the asset-holders 0.286 -> 0.571,
#     put COST and GOOGL over the reliability bar, and took
#     NVDA off it (its two added episodes are both false).
#   S4 clean-print sell veto — a sell episode (a contiguous
#     run of sell days) is suppressed whole when, on its first
#     day, the latest print is at most 126 trading days old
#     and clean on all three legs: EPS YoY >= 0, revenue
#     YoY >= 0, gross-margin change YoY >= 0. In the study
#     the veto removed 20 of the control's 28 validation
#     operator sell episodes — every one of them false — and
#     no captured episode in either era. It prunes false
#     sells; the sells that survive still capture nothing,
#     and the veto creates no sell signal of its own.
#   R2 rotation veto (added 2026-11-23; Johnny's adoption of
#     sell study #2's one passing candidate, from the family
#     he named himself — sector cycles): a sell episode is
#     also suppressed whole when the name's sector is
#     rotating UP on the episode's first day. The regime is
#     the study's exact construction: RS = the sector ETF's
#     adjusted close / the SPX close (the SPX close carried
#     forward onto the ETF's own calendar); a sector is UP
#     when its RS line sits above its own trailing 200-day
#     average and RS is higher than 63 trading days earlier,
#     DOWN when below and lower, MIXED otherwise, and
#     undefined until the 200-day average exists. The regime
#     in force on a name's date is the ETF calendar's latest
#     value on or before that date. Each of the 19 maps to
#     one ETF (see _SECTOR_ETF_OF below): semiconductors to
#     SMH, technology to XLK, staples to XLP, healthcare to
#     XLV, financials to XLF, discretionary to XLY,
#     industrials to XLI. In the study (validation era, the
#     19) 19 of the gate's 29 sell episodes fired into UP
#     sectors and those names rose a median +82.3% in the
#     following year; suppressing them leaves 10 episodes
#     at +21.1% / +25.3% forward 1y / 2y against the
#     control's +25.9% / +49.4%. The honest limit stands:
#     the kept sells still rose — the veto removes the
#     disaster, it does not create a good sell, and it
#     creates no sell signal of its own. The study tested
#     the 19 only, so no other series carries the veto;
#     buys are untouched.
# Names the earnings family cannot see stay untouched: SPX,
# IXIC, GOLD, BTC and the band/commodity series have no
# earnings at all; NBIS and TSM file no usable quarterly
# facts in EDGAR's standardized data; JPM reports no gross
# margin (banks do not), so S4 can never fire on it; ASST's
# prints carry no computable EPS year-over-year change, and
# the gate itself still cannot fire on ASST (its history is
# shorter than the 1,000 closes the 200-week average needs).
# Preferred zones (added 2026-11-23; Johnny's settled STRC/
# SATS buy formula, from the preferred-formula studies of the
# same day): the two $100-stated-value preferreds — STRC
# (Strategy) and SATS (Strive) — do not take the gate above at
# all on the buy side. Their buy dots are discount zones below
# the $100 stated value, the discount alone deciding (no RSI,
# VIX, drawdown, PEG or any other leg, and no steering-wheel
# guard — Johnny considered the guard and rejected it):
# Shallow fires on the first close <= $99, Deep on the first
# close <= $95, Distress on the first close <= $85 — one dot
# per zone entry, the zones independent, so a single day's
# gap can enter several zones at once (SATS entered Shallow
# and Deep on its listing day). A zone re-arms only after a
# close back above the next boundary up: Shallow on a close
# >= $100, Deep on a close > $99, Distress on a close > $95.
# On the history the studies scored (through 2026-11-20) the
# rule dots 10 STRC days (Shallow 4, Deep 5, Distress 1) and
# 2 SATS days. The SELL side is NOT replaced: no preferred
# sell rule has been decided, so the preferreds keep the
# no-PEG gate sell below — which cannot fire while their
# 200-week average is undefined (0 defined days on both
# series today) — and no sell rule is invented here in the
# meantime. The >= 85 score never applies to them either
# (see compute_score_buy_days): their buy dots are the zone
# dots alone.
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

_SIGNAL_NO_PEG_KEYS = {"SPX", "IXIC", "GOLD", "BTC"} | BAND_KEYS \
    | PREFERRED_KEYS
# The index class inside the no-PEG keys: SPX and IXIC buy at the
# wider -25% drawdown line (see the index split note above); every
# other no-PEG key keeps -30%.
_SIGNAL_INDEX_KEYS = {"SPX", "IXIC"}
_SIGNAL_PERSIST = 5

# The R2 rotation veto's sector map (sell study #2, verbatim):
# each of Johnny's 19 to the one sector ETF whose relative-
# strength regime can veto its sell episodes. The study tested
# these 19 only — no other series is mapped, so no other series
# carries the veto. (XLE sits in the study's ETF family but no
# name maps to it, so the run never fetches it.)
_SECTOR_ETF_OF = {
    "NVDA": "SMH", "AMD": "SMH", "MU": "SMH", "TSM": "SMH",
    "GOOGL": "XLK", "PLTR": "XLK", "MSTR": "XLK", "AAOI": "XLK",
    "NBIS": "XLK", "CIFR": "XLK", "IREN": "XLK", "ASST": "XLK",
    "SPCX": "XLK",
    "WMT": "XLP", "COST": "XLP", "LLY": "XLV", "JPM": "XLF",
    "TSLA": "XLY", "WM": "XLI",
}
_SECTOR_ETFS = sorted(set(_SECTOR_ETF_OF.values()))


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


# The preferreds' zone rules (see the Preferred zones note
# above compute_indicator_signals): (entry close, re-arm test)
# per zone, in Shallow / Deep / Distress order. A zone fires
# on the first close at or below its entry while armed, then
# disarms; it re-arms only on a close back above the next
# boundary up — Shallow at par itself (>= $100), Deep above
# the Shallow entry (> $99), Distress above the Deep entry
# (> $95).
_PREFERRED_ZONE_RULES = (
    (99.0, lambda c: c >= 100.0),
    (95.0, lambda c: c > 99.0),
    (85.0, lambda c: c > 95.0),
)


def _preferred_zone_buys(dates, closes):
    """Buy dates for STRC/SATS under Johnny's settled preferred
    formula: one dot per entry into each discount zone below
    the $100 stated value. The zones are independent — a day
    that gaps through two zones enters both — and every zone
    starts armed, so a series that lists below a boundary
    (SATS listed at $94.61) enters its zones on its first bar."""
    out = []
    for entry, rearm in _PREFERRED_ZONE_RULES:
        armed = True
        for i, c in enumerate(closes):
            if armed:
                if c <= entry:
                    out.append(dates[i])
                    armed = False
            elif rearm(c):
                armed = True
    return sorted(out)


def _episode_runs(idxs):
    """Group a sorted index list into its contiguous runs —
    the sell episodes the S4 and R2 vetoes judge whole."""
    runs = []
    for i in idxs:
        if runs and i == runs[-1][-1] + 1:
            runs[-1].append(i)
        else:
            runs.append([i])
    return runs


def _sector_rs_regimes(etf_dates, etf_adj, spx_dates, spx_closes):
    """{etf_date: "UP"/"DOWN"/"MIXED"/None} — sell study #2's
    sector regime, reproduced exactly (see the R2 note above).

    RS rides the ETF's own calendar: each ETF bar's RS is its
    adjusted close over the last SPX close on or before its
    date. The 200-day average is the trailing mean of RS,
    defined only where the full 200-bar window exists (a gap
    in RS leaves the average undefined for the whole window
    that contains it — the study's NaN-robust mean). A bar's
    regime is None until that average exists and the bar 63
    back has an RS; UP needs RS above the average and rising
    over those 63 bars, DOWN below and falling, else MIXED."""
    rs = []
    for i, d in enumerate(etf_dates):
        j = bisect.bisect_right(spx_dates, d) - 1
        rs.append(etf_adj[i] / spx_closes[j] if j >= 0 else None)
    out = {}
    total = 0.0
    gaps = 0
    for i, d in enumerate(etf_dates):
        v = rs[i]
        if v is None:
            gaps += 1
        else:
            total += v
        if i >= 200:
            old = rs[i - 200]
            if old is None:
                gaps -= 1
            else:
                total -= old
        if i < 199 or i < 63 or gaps or rs[i - 63] is None:
            out[d] = None
            continue
        ma = total / 200.0
        chg = rs[i] / rs[i - 63] - 1.0
        if rs[i] > ma and chg > 0:
            out[d] = "UP"
        elif rs[i] < ma and chg < 0:
            out[d] = "DOWN"
        else:
            out[d] = "MIXED"
    return out


def _regime_on(etf_dates, regimes, day):
    """The sector regime in force on a name's bar date: the
    ETF calendar's latest regime value on or before that
    date — None included, exactly as the study reads it (an
    undefined day is not UP, so it vetoes nothing)."""
    j = bisect.bisect_right(etf_dates, day) - 1
    if j < 0:
        return None
    return regimes[etf_dates[j]]


def compute_indicator_signals(key, bars, pe, vix_dates, vix_closes,
                              earn=None, sector_regimes=None):
    """(buy_dates, sell_dates) for one daily series. `earn`, when
    given, is the series' earnings_daily_state: the adopted B1
    door unions its days into the buys and the S4 veto suppresses
    its clean-print sell episodes (see the formula notes above).
    Only the 19 earnings-universe stocks ever receive one.
    `sector_regimes`, when given, is the series' sector ETF
    calendar and regime map: the adopted R2 rotation veto
    suppresses its sell episodes that open in an UP regime.
    Only the same 19 stocks — the study's mapped names — ever
    receive one."""
    dates = [b[0] for b in bars]
    closes = [float(b[4]) for b in bars]
    n = len(closes)
    # STRC/SATS: the preferred zone formula replaces the gate
    # on the buy side (see the Preferred zones note above).
    # The gate loop below still runs for them — their sell
    # side is the gate's no-PEG sell, exactly as staged — and
    # its buy result is discarded at the return.
    zone_buy = _preferred_zone_buys(dates, closes) \
        if key in PREFERRED_KEYS else None
    ma = _sig_ma200w(closes)
    rsi = _sig_rsi(closes)
    dd = _sig_drawdown(closes)
    peg = None if key in _SIGNAL_NO_PEG_KEYS else _sig_peg(bars, pe)
    buy = []
    sell_idx = []
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
            dd_line = -0.25 if key in _SIGNAL_INDEX_KEYS else -0.30
            is_buy = rsi[i] <= 30 and vix >= 25 and dd[i] <= dd_line
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
            is_buy = (rsi[i] <= 30 and vix >= 25 and dd[i] <= -0.30
                      and peg_ok)
            if not is_buy and peg[i] is not None and peg[i] <= 2.0:
                # The quality door (see the formula notes above
                # compute_indicator_signals): the same oversold
                # and panic legs at a shallower drawdown, the
                # close below its 200-week average, and a defined
                # PEG at or under Lynch's warning line of 2. A day
                # whose PEG is undefined — the -40% stand-in days
                # included — never opens this door.
                is_buy = (rsi[i] <= 30 and vix >= 25
                          and dd[i] <= -0.20 and closes[i] < ma[i])
        if is_buy:
            buy.append(dates[i])
        run = run + 1 if is_sell else 0
        if run >= _SIGNAL_PERSIST:
            sell_idx.append(i)
    if earn is not None:
        # B1 good-print door: its own pass, exactly as studied —
        # no 200-week-average condition and no PEG leg, so it is
        # not subject to the gate loop's ma-defined skip above.
        buy_set = set(buy)
        for i in range(n):
            age = earn["age"][i]
            if age is None or age > 90:
                continue
            ey, ry = earn["eps_yoy"][i], earn["rev_yoy"][i]
            if ey is None or ey <= 0 or ry is None or ry <= 0:
                continue
            if rsi[i] is None or rsi[i] > 30:
                continue
            if dd[i] > -0.20:
                continue
            j = bisect.bisect_right(vix_dates, dates[i]) - 1
            if j < 0 or vix_closes[j] < 25:
                continue
            buy_set.add(dates[i])
        buy = sorted(buy_set)
        # S4 clean-print veto: group the sell days into episodes
        # (contiguous runs); an episode whose FIRST day carries a
        # clean print at most 126 trading days old is suppressed
        # whole.
        if sell_idx:
            runs = _episode_runs(sell_idx)
            kept = []
            for r in runs:
                s = r[0]
                age = earn["age"][s]
                ey = earn["eps_yoy"][s]
                ry = earn["rev_yoy"][s]
                gm = earn["gm_chg_yoy"][s]
                clean = (age is not None and age <= 126
                         and ey is not None and ey >= 0
                         and ry is not None and ry >= 0
                         and gm is not None and gm >= 0)
                if not clean:
                    kept.extend(r)
            sell_idx = kept
    if sector_regimes is not None and sell_idx:
        # R2 rotation veto: group the surviving sell days into
        # episodes; an episode whose FIRST day falls in a sector
        # rotating UP is suppressed whole — the study's exact
        # split (its kept/dropped sets were episodes classified
        # by the regime at the start). Runs after S4: both
        # vetoes remove whole episodes from the same grouping,
        # so the surviving set is the union of their removals
        # in either order.
        etf_dates, regimes = sector_regimes
        kept = []
        for r in _episode_runs(sell_idx):
            if _regime_on(etf_dates, regimes, dates[r[0]]) != "UP":
                kept.extend(r)
        sell_idx = kept
    if zone_buy is not None:
        buy = zone_buy
    return buy, [dates[i] for i in sell_idx]


_SIGNAL_SCORE_STRONG = 85


def compute_score_buy_days(key, bars, pe, vix_dates, vix_closes):
    """Dates whose Buy Opportunity Score reaches the strong tier
    (85 of 100) — the graded-score study's V1 score, reproduced
    exactly (see the Score dots notes above compute_indicator_
    signals). Points: drawdown depth 30 (15/20/25/30/35/40% ->
    5/10/15/20/25/30), RSI(14) 20 (<=25/30/35/40/50 ->
    20/17/13/8/4), valuation 25 (PEG <=0.75/1.00/1.25/1.50/2.00
    -> 25/22/18/14/8, above 2.00 -> 3; where PEG cannot compute,
    22 when the drawdown is at least -40%, else 0 — the same
    stand-in for the no-P/E classes, benchmarks and band
    instruments included), distance from the 200-week average
    15 (deviation <=-30/-20/-10/+10/+25% -> 15/13/10/5/2),
    VIX 10 (>=30/25/20/15 -> 10/8/5/2). A day is scored only
    where the RSI and the 200-week average are defined."""
    if key in PREFERRED_KEYS:
        # The >= 85 score never applies to the preferreds:
        # their buy dots are the L3 zone dots alone (Johnny's
        # settled formula), and the score's legs — PEG stand-in,
        # distance from the 200-week average — have no meaning
        # on a $100-stated-value instrument. The exclusion is
        # stated, not emergent: the score below could not fire
        # for them today anyway (it scores only days where the
        # 200-week average is defined — 0 such days on both
        # series), but it stays excluded when that changes.
        return []
    dates = [b[0] for b in bars]
    closes = [float(b[4]) for b in bars]
    n = len(closes)
    ma = _sig_ma200w(closes)
    rsi = _sig_rsi(closes)
    dd = _sig_drawdown(closes)
    peg = None if key in _SIGNAL_NO_PEG_KEYS else _sig_peg(bars, pe)
    out = []
    for i in range(n):
        if ma[i] is None or rsi[i] is None:
            continue
        depth = -dd[i]
        if depth >= 0.40:
            p_dd = 30
        elif depth >= 0.35:
            p_dd = 25
        elif depth >= 0.30:
            p_dd = 20
        elif depth >= 0.25:
            p_dd = 15
        elif depth >= 0.20:
            p_dd = 10
        elif depth >= 0.15:
            p_dd = 5
        else:
            p_dd = 0
        r = rsi[i]
        if r <= 25:
            p_rsi = 20
        elif r <= 30:
            p_rsi = 17
        elif r <= 35:
            p_rsi = 13
        elif r <= 40:
            p_rsi = 8
        elif r <= 50:
            p_rsi = 4
        else:
            p_rsi = 0
        if key in _SIGNAL_NO_PEG_KEYS or peg[i] is None:
            p_val = 22 if depth >= 0.40 else 0
        elif peg[i] <= 0.75:
            p_val = 25
        elif peg[i] <= 1.00:
            p_val = 22
        elif peg[i] <= 1.25:
            p_val = 18
        elif peg[i] <= 1.50:
            p_val = 14
        elif peg[i] <= 2.00:
            p_val = 8
        else:
            p_val = 3
        dev = closes[i] / ma[i] - 1.0
        if dev <= -0.30:
            p_dev = 15
        elif dev <= -0.20:
            p_dev = 13
        elif dev <= -0.10:
            p_dev = 10
        elif dev <= 0.10:
            p_dev = 5
        elif dev <= 0.25:
            p_dev = 2
        else:
            p_dev = 0
        j = bisect.bisect_right(vix_dates, dates[i]) - 1
        if j < 0:
            p_vix = 0
        else:
            v = vix_closes[j]
            if v >= 30:
                p_vix = 10
            elif v >= 25:
                p_vix = 8
            elif v >= 20:
                p_vix = 5
            elif v >= 15:
                p_vix = 2
            else:
                p_vix = 0
        if p_dd + p_rsi + p_val + p_dev + p_vix >= _SIGNAL_SCORE_STRONG:
            out.append(dates[i])
    return out


def attach_indicator_signals(d_series, d_previous, earn_states=None,
                             sector_data=None):
    """Compute buy/sell dates for every daily series in place.
    `earn_states` maps any of the 19 earnings-universe keys to
    its earnings_daily_state; those series' signals carry the
    adopted B1 door / S4 veto. `sector_data` maps any of the
    same 19 keys to its sector ETF's (dates, regime map); those
    series' signals carry the adopted R2 rotation veto. Where
    a series' gate arrays are
    carried over for this run only (the transient-P/E branch
    below), the carried arrays stand whole — door and veto
    included in what is set aside, exactly as the rest of the
    gate is.

    The VIX series built in this same run is the input; if it is
    somehow absent, the previous file's signals stand untouched.
    A stock with no P/E this run is handled by WHY it has none,
    judged against the previous file:

    - The previous file HAD a pe for it: this run's absence reads
      as a transient EDGAR failure. The previous signals carry,
      filtered to dates its current bars still carry, for THIS
      RUN ONLY, under a WARNING — the file this run writes holds
      no pe for the series, so if the P/E is still missing next
      run the absence reads as structural (below) and the signals
      recompute. The carry can never silently repeat.
    - The previous file had no pe either (or there is no previous
      entry): the absence is structural — the filer's EDGAR facts
      carry no usable USD/shares diluted EPS (an IFRS filer whose
      companyfacts hold totals only, a reported per-share basis
      that does not match the listed price, earnings never
      positive, too little filed history to form a TTM). PEG
      genuinely cannot compute, so the freshly computed signals
      stand: on the buy side they already use the formula's own
      stand-in leg (the deeper -40% drawdown in place of the PEG
      check, inside compute_indicator_signals); no sell can fire
      without a defined PEG, exactly as the formula defines.

    The earlier rule carried the previous signals in BOTH cases,
    which froze a structurally P/E-less series' dots at whatever
    an older input vintage had produced, indefinitely and almost
    silently — TSM served 9 buy days against the 19 the formula
    computes (found 2026-11-22, graded-score study)."""
    vix_entry = d_series.get("VIX") or {}
    vix_bars = vix_entry.get("bars") or []
    if not vix_bars:
        log("  indicator: no VIX series this run — previous signals stand")
        return
    vix_dates = [b[0] for b in vix_bars]
    vix_closes = [float(b[4]) for b in vix_bars]
    total_buy = 0
    total_sell = 0
    total_score = 0
    standin = []
    for key, entry in d_series.items():
        if key == "VIX":
            continue
        bars = entry.get("bars") or []
        if not bars:
            continue
        buy, sell = compute_indicator_signals(
            key, bars, entry.get("pe"), vix_dates, vix_closes,
            earn=(earn_states or {}).get(key),
            sector_regimes=(sector_data or {}).get(key))
        if key not in _SIGNAL_NO_PEG_KEYS and not entry.get("pe"):
            prev = d_previous.get(key) or {}
            if prev.get("pe"):
                have = {b[0] for b in bars}
                buy = [d for d in (prev.get("buy") or []) if d in have]
                sell = [d for d in (prev.get("sell") or []) if d in have]
                log("  WARNING indicator: %s had a P/E last run but "
                    "none this run — previous signals carried for "
                    "THIS RUN ONLY; if the P/E is still missing "
                    "next run, its signals recompute on the "
                    "stand-in leg" % key)
            else:
                standin.append(key)
                log("  indicator: %s has no P/E (none last run "
                    "either) — signals computed on the stand-in "
                    "leg (drawdown <= -40%% stands in for PEG)"
                    % key)
        entry["buy"] = buy
        entry["sell"] = sell
        # Score dots: the >= 85 days that are not already gate
        # buy days (the final buy array above, carry-over
        # included) — the union's second dot class. Computed
        # fresh every run like the gate; where the gate's arrays
        # were carried over for this run only, the score days
        # are still this run's, measured against the carried
        # buy set, so a day is never emitted in both classes.
        buy_set = set(buy)
        entry["score_buys"] = [
            d for d in compute_score_buy_days(
                key, bars, entry.get("pe"), vix_dates, vix_closes)
            if d not in buy_set]
        total_buy += len(buy)
        total_sell += len(sell)
        total_score += len(entry["score_buys"])
    log("Indicator signals: %d buy days, %d sell days across %d series."
        % (total_buy, total_sell, len(d_series) - 1))
    log("Indicator score dots: %d days at score >= %d that are "
        "not already buy days."
        % (total_score, _SIGNAL_SCORE_STRONG))
    if standin:
        log("Indicator: %d series computed on the stand-in leg "
            "(no P/E): %s"
            % (len(standin), ", ".join(sorted(standin))))


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
_FIN_BENCH = {"SPX", "IXIC", "GOLD", "BTC", "VIX"} | BAND_KEYS


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


def build_first_file(d_output, out_dir, log=print):
    """Write finance-chart-first.json — the Finance page's
    first-paint file, built from this run's daily output (see the
    load-speed spec, 2026-11-23). Same top-level shape as the daily
    file, holding only what the first screen paints from:

    - series.SPX: the full SPX entry with its bars (and the P/E
      array, sliced at the same bar) trimmed to FIRST_FILE_CUTOFF;
      the buy / sell / score_buys signal arrays ride in full —
      signal dates are few and are never trimmed;
    - latest: for every series, its name and its most recent 24 buy
      and 24 sell dates — everything the Latest-dots panel reads;
    - the daily file's own last_updated / through, so the page can
      key its cache on the same data day.

    Isolated like the market-context and intraday writers: the
    caller catches any failure and the previous file stands."""
    d_series = d_output["series"]
    spx = d_series.get("SPX")
    if not spx or not spx.get("bars"):
        raise ValueError("daily output carries no SPX bars")
    entry = dict(spx)
    bars = spx["bars"]
    cut = 0
    while cut < len(bars) and bars[cut][0] < FIRST_FILE_CUTOFF:
        cut += 1
    entry["bars"] = bars[cut:]
    pe = spx.get("pe")
    if pe is not None and len(pe) == len(bars):
        entry["pe"] = pe[cut:]
    latest = {}
    for key, s in d_series.items():
        if not s:
            continue
        latest[key] = {
            "name": s.get("name"),
            "buy": (s.get("buy") or [])[-24:],
            "sell": (s.get("sell") or [])[-24:],
        }
    output = {
        "last_updated": d_output["last_updated"],
        "source": "The Finance page's first-paint file: SPX daily "
                  "bars since %s plus every series' latest buy / "
                  "sell signal dates, split from the same run's "
                  "finance-chart-daily.json — see that file for the "
                  "full data and its source note."
                  % FIRST_FILE_CUTOFF,
        "through": d_output["through"],
        "series": {"SPX": entry},
        "latest": latest,
        "nasdaq100": d_output.get("nasdaq100"),
    }
    out_path = os.path.join(out_dir, FIRST_OUT_FILE)
    tmp_path = out_path + ".tmp"
    with open(tmp_path, "w") as fh:
        json.dump(output, fh, separators=(",", ":"))
    os.replace(tmp_path, out_path)
    log("Wrote %s (SPX %d bars since %s, latest dots for %d series, "
        "through %s)."
        % (out_path, len(entry["bars"]), FIRST_FILE_CUTOFF,
           len(latest), output["through"]))


def guard_no_shrink(kind, new_series, prev_series, through, anchor,
                    allowance_days):
    """Completeness guard (2026-11-23, the Bitcoin rule): a run
    whose output would shrink the published record or end it
    early must fail, never publish. Returns a list of problems
    (empty = the output may ship):
      - every series the previous file carries must still be
        present, with at least as many bars, ending no earlier;
      - the file's through must sit within allowance_days of the
        anchor (the last completed period this run set out to
        reach) — the allowance covers market holidays, which
        last_completed_day / last_completed_friday do not model.
    A deliberate universe removal trips the first rule on
    purpose: the run fails loudly until a human refreshes the
    previous file, rather than a series vanishing in silence."""
    problems = []
    for key in sorted(prev_series):
        prev_bars = (prev_series.get(key) or {}).get("bars") or []
        if not prev_bars:
            continue
        new_bars = (new_series.get(key) or {}).get("bars") or []
        if not new_bars:
            problems.append("%s: %s series vanished" % (kind, key))
        elif len(new_bars) < len(prev_bars):
            problems.append("%s: %s shrank %d -> %d bars"
                            % (kind, key, len(prev_bars),
                               len(new_bars)))
        elif new_bars[-1][0] < prev_bars[-1][0]:
            problems.append("%s: %s ends %s, before the previous %s"
                            % (kind, key, new_bars[-1][0],
                               prev_bars[-1][0]))
    if not through:
        problems.append("%s: no series carries bars" % kind)
    elif (anchor - date.fromisoformat(through)).days > allowance_days:
        problems.append("%s: through %s is %d days before the last "
                        "completed period %s"
                        % (kind, through,
                           (anchor - date.fromisoformat(through)).days,
                           anchor))
    return problems


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
    full_facts_cache = {}
    splits_cache = {}

    def pe_for(key, symbol, bars):
        if key in BENCHMARK_KEYS or symbol in PE_EXCLUDE:
            return None
        cik = cik_map.get(symbol)
        if not cik:
            return None
        if cik not in facts_cache:
            facts = fetch_edgar_json(EDGAR_FACTS_URL % cik)
            full_facts_cache[cik] = facts
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
            elif key in BAND_KEYS:
                # A band instrument (pass 2) must never fail the
                # whole run — least of all on its first run, when no
                # previous series exists yet. The page treats the
                # missing series as an honest empty state; the cell
                # still selects, the chart says no data yet.
                log("  band instrument %s has no data this run — "
                    "skipping it (the run continues)" % key)
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
        if key in BAND_KEYS:
            # The band's own instruments (pass 2): the page's stock
            # dropdown skips "band" entries exactly like "ndx" ones;
            # the strip itself selects them.
            entry["band"] = True
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
    problems = guard_no_shrink("weekly", series, previous,
                               output["through"], through, 9)
    if problems:
        for p in problems:
            log("GUARD: %s" % p)
        log("Refusing to publish a shrunken or stale %s — the "
            "previous file stands." % out_path)
        return 1
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
            elif key in BAND_KEYS:
                # Same first-run rule as the weekly loop: a band
                # instrument with no data yet skips, never fails.
                log("  band instrument %s has no daily data this run "
                    "— skipping it (the run continues)" % key)
            else:
                d_missing.append(key)
            time.sleep(1)
            continue
        log("  %d daily bars, %s .. %s, last close %.2f"
            % (len(bars), bars[0][0], bars[-1][0], bars[-1][4]))
        entry = {"name": name, "symbol": symbol, "bars": bars}
        if key in NDX_ONLY_KEYS:
            entry["ndx"] = True
        if key in BAND_KEYS:
            entry["band"] = True
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

    # Earnings state for the adopted B1 door / S4 veto: events
    # built from the same companyfacts this run already pulled
    # for P/E (the full document is cached per CIK in pe_for;
    # TSM, which the P/E path excludes by rule, is fetched here
    # on its own). Any failure leaves that name's signals
    # without the door/veto this run — logged, never silent —
    # and never touches the price or P/E data.
    earn_states = {}
    for key in EARNINGS_KEYS:
        entry = d_series.get(key)
        if not entry or not entry.get("bars"):
            continue
        try:
            cik = cik_map.get(key)
            if not cik:
                log("  earnings: no CIK for %s — no door/veto" % key)
                continue
            facts = full_facts_cache.get(cik)
            if facts is None:
                facts = fetch_edgar_json(EDGAR_FACTS_URL % cik)
                full_facts_cache[cik] = facts
                time.sleep(0.15)  # SEC fair access, as in pe_for
            events = build_earnings_events(key, facts)
            state = earnings_daily_state(
                events, [b[0] for b in entry["bars"]])
            if state is None:
                log("  earnings: %s — %d prints, none tradable on "
                    "its bars; no door/veto" % (key, len(events)))
                continue
            earn_states[key] = state
            log("  earnings: %s — %d prints; door/veto state live"
                % (key, len(events)))
        except Exception as exc:
            log("  earnings FAILED for %s (%s) — its signals ship "
                "without the earnings door/veto this run"
                % (key, exc))

    # Sector RS regimes for the adopted R2 rotation veto: one
    # adjusted-close pull per mapped ETF, regimes built against
    # this run's own SPX bars (the study's construction). Like
    # the earnings state above, any failure is logged and
    # leaves that ETF's names without the veto this run — it
    # never touches the price or P/E data and never fails the
    # run.
    sector_data = {}
    spx_entry = d_series.get("SPX") or {}
    spx_bars = spx_entry.get("bars") or []
    if spx_bars:
        spx_dates = [b[0] for b in spx_bars]
        spx_closes = [float(b[4]) for b in spx_bars]
        for etf in _SECTOR_ETFS:
            try:
                etf_dates, etf_adj = fetch_yahoo_adjclose(
                    etf, d_period1, period2)
                if not etf_dates:
                    raise ValueError("no adjusted closes returned")
                regimes = _sector_rs_regimes(
                    etf_dates, etf_adj, spx_dates, spx_closes)
                names = [k for k, v in _SECTOR_ETF_OF.items()
                         if v == etf]
                for key in names:
                    sector_data[key] = (etf_dates, regimes)
                log("  sector: %s — %d adjusted closes; rotation "
                    "veto live for %s"
                    % (etf, len(etf_dates), ", ".join(sorted(names))))
            except Exception as exc:
                log("  sector FAILED for %s (%s) — its names ship "
                    "without the rotation veto this run" % (etf, exc))
            time.sleep(1)  # be polite to the endpoint
    else:
        log("  sector: no SPX series this run — the rotation "
            "veto is not applied")

    # Johnny's indicator: buy/sell signal dates on every daily
    # series, from this run's own bars, P/E and VIX (see the
    # indicator section above compute_pe).
    try:
        attach_indicator_signals(d_series, d_previous, earn_states,
                                 sector_data)
    except Exception as exc:
        # The dots are the daily file's purpose as much as the
        # bars: a file with signals missing or half-computed is a
        # truncated record (2026-11-23 rule) — fail the run and
        # let the previous file stand.
        log("ERROR: indicator signals failed (%s) — leaving the "
            "previous %s untouched rather than ship a daily file "
            "whose dots are missing or half-computed."
            % (exc, daily_path))
        return 1

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
    problems = guard_no_shrink("daily", d_series, d_previous,
                               d_output["through"], through_day, 4)
    if problems:
        for p in problems:
            log("GUARD: %s" % p)
        log("Refusing to publish a shrunken or stale %s — the "
            "previous file stands." % daily_path)
        return 1
    d_tmp_path = daily_path + ".tmp"
    with open(d_tmp_path, "w") as fh:
        json.dump(d_output, fh, separators=(",", ":"))
    os.replace(d_tmp_path, daily_path)
    log("Wrote %s (%d instruments, through %s%s)."
        % (daily_path, len(d_series), d_output["through"],
           ", kept previous for: " + ", ".join(d_kept_old) if d_kept_old else ""))

    # ---- first-paint file: finance-chart-first.json ----
    # The small split of the daily file the Finance page paints
    # its first screen from (SPX since 2017 + every series' latest
    # dots). Isolated like the market context below: any failure
    # leaves the previous first-paint file standing and never
    # touches the chart files; the page falls back to the full
    # daily file whenever this one is missing.
    try:
        build_first_file(
            d_output, os.path.dirname(os.path.abspath(daily_path)),
            log=log)
    except Exception as exc:
        log("WARNING: first-paint file failed (%s) — previous "
            "finance-chart-first.json stands." % exc)

    # ---- market context: finance-context.json (market_context.py) ----
    # Insider clusters, universe breadth, high-yield spread — data
    # only, no signal consumes it. Isolated like the share
    # snapshots above: any failure leaves the previous context
    # file standing and never touches the chart files. The
    # workflow's commit step picks the file up once its name
    # joins the git add line, exactly as the daily file did.
    try:
        import market_context
        market_context.build_context_file(
            d_series, os.path.dirname(os.path.abspath(daily_path)),
            log=log)
    except Exception as exc:
        log("WARNING: market context failed (%s) — previous "
            "finance-context.json stands." % exc)

    # ---- intraday sessions: finance-intraday.json (fetch_intraday.py) ----
    # The last five 04:00-20:00 ET sessions of 1-minute bars for the
    # chart's primary series — the Daily 1D / 1W ranges draw from
    # it. Isolated like the market context above: any failure
    # leaves the previous intraday file standing (the chart falls
    # back to daily bars for any series the file lacks) and never
    # touches the chart files. The workflow's commit step picks
    # the file up once its name joins the git add line.
    try:
        import fetch_intraday
        fetch_intraday.build_intraday_file(
            d_series, os.path.dirname(os.path.abspath(daily_path)),
            log=log)
    except Exception as exc:
        log("WARNING: intraday sessions failed (%s) — previous "
            "finance-intraday.json stands." % exc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
