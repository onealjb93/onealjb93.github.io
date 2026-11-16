"""Fetch weekly OHLCV bars from the Yahoo Finance v8 chart API.

One file, one purpose: build finance-chart-data.json for The Chart on
finance.html — the page's own chart (amber 200-week / blue 50-week /
violet weekly RSI), which replaced the TradingView embed on 2026-11-16
because the free widget cannot colour or thicken its two moving
averages separately (its overrides are keyed per study type, and both
averages are the same type).

Instruments: the S&P 500 (^GSPC), the Nasdaq Composite (^IXIC),
gold futures (GC=F), Bitcoin (BTC-USD), and Johnny's 19 scoreboard
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
"""

import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone

import requests

# (page key, Yahoo symbol, display name)
INSTRUMENTS = [
    ("SPX", "^GSPC", "S&P 500"),
    ("IXIC", "^IXIC", "Nasdaq Composite"),
    ("GOLD", "GC=F", "Gold"),
    ("BTC", "BTC-USD", "Bitcoin"),
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
HEADERS = {"User-Agent": "Mozilla/5.0 (onealjb93.github.io chart updater)"}
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
START = date(2000, 1, 1)


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
                  "completed weeks only",
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
